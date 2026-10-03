"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { audit } from "@/lib/audit"
import { requireAdmin } from "@/lib/auth"
import { invalidateGatewayConfig } from "@/lib/gateway/config"
import { supabaseAdmin } from "@/lib/supabase/admin"

import {
  MAX_ROUTE_TARGETS,
  routeNameError,
  type RouteSettingsInput,
} from "./shared"

const idSchema = z.guid()
const kindSchema = z.enum(["chat", "embedding"])
const strategySchema = z.enum(["fallback", "round_robin"])
const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Keep the description under 500 characters")
  .transform((value) => value || null)

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input"
}

/** Everything that shows routes, plus the gateway's in-memory snapshot. */
function refresh(routeId?: string) {
  invalidateGatewayConfig()
  revalidatePath("/routes")
  if (routeId) revalidatePath(`/routes/${routeId}`)
  revalidatePath("/playground")
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((value, ctx) => {
      const problem = routeNameError(value)
      if (problem) ctx.addIssue({ code: "custom", message: problem })
    }),
  description: descriptionSchema,
  kind: kindSchema,
  strategy: strategySchema,
})

export async function createRoute(input: {
  name: string
  description: string
  kind: string
  strategy: string
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin()
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { name, description, kind, strategy } = parsed.data

  const { data, error } = await supabaseAdmin()
    .from("routes")
    .insert({ name, description, kind, strategy })
    .select("id")
    .single()
  if (error) {
    return error.code === "23505"
      ? { ok: false, error: `A route named "${name}" already exists` }
      : actionError(error)
  }

  const id = (data as { id: string }).id
  await audit(
    me.email,
    "route.create",
    `Created route '${name}'`,
    { type: "route", id, name },
    { description, kind, strategy }
  )
  refresh(id)
  return {
    ok: true,
    data: { id },
    message: `Route "${name}" created. Add some models to it.`,
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsSchema = z
  .object({
    description: descriptionSchema,
    strategy: strategySchema,
    maxAttempts: z
      .number("Max attempts must be a number")
      .int("Max attempts must be a whole number")
      .min(1, "Max attempts must be between 1 and 10")
      .max(10, "Max attempts must be between 1 and 10"),
    timeoutSeconds: z
      .number("Timeout must be a number")
      .min(1, "Timeout must be between 1 and 3600 seconds")
      .max(3600, "Timeout must be between 1 and 3600 seconds"),
    firstTokenTimeoutSeconds: z
      .number("First-token timeout must be a number")
      .min(1, "First-token timeout must be between 1 and 3600 seconds")
      .max(3600, "First-token timeout must be between 1 and 3600 seconds"),
    enabled: z.boolean(),
  })
  .refine((value) => value.firstTokenTimeoutSeconds <= value.timeoutSeconds, {
    error: "The first-token timeout can't be longer than the overall timeout",
  })

export async function updateRouteSettings(
  routeId: string,
  input: RouteSettingsInput
): Promise<ActionResult> {
  const me = await requireAdmin()
  const id = idSchema.safeParse(routeId)
  if (!id.success) return { ok: false, error: "Route not found" }
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const settings = parsed.data

  const { data, error } = await supabaseAdmin()
    .from("routes")
    .update({
      description: settings.description,
      strategy: settings.strategy,
      max_attempts: settings.maxAttempts,
      timeout_ms: Math.round(settings.timeoutSeconds * 1000),
      first_token_timeout_ms: Math.round(
        settings.firstTokenTimeoutSeconds * 1000
      ),
      enabled: settings.enabled,
    })
    .eq("id", id.data)
    .select("id, name")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Route not found" }

  const name = (data as { name: string }).name
  await audit(
    me.email,
    "route.update",
    `Changed settings of route '${name}'`,
    { type: "route", id: id.data, name },
    settings
  )
  refresh(id.data)
  return { ok: true, message: "Route settings saved" }
}

export async function setRouteEnabled(
  routeId: string,
  enabled: boolean
): Promise<ActionResult> {
  const me = await requireAdmin()
  const parsed = z
    .object({ id: idSchema, enabled: z.boolean() })
    .safeParse({ id: routeId, enabled })
  if (!parsed.success) return { ok: false, error: "Invalid request" }

  const { data, error } = await supabaseAdmin()
    .from("routes")
    .update({ enabled: parsed.data.enabled })
    .eq("id", parsed.data.id)
    .select("name")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Route not found" }

  const name = (data as { name: string }).name
  await audit(
    me.email,
    parsed.data.enabled ? "route.enable" : "route.disable",
    `${parsed.data.enabled ? "Enabled" : "Disabled"} route '${name}'`,
    { type: "route", id: parsed.data.id, name }
  )
  refresh(parsed.data.id)
  return {
    ok: true,
    message: parsed.data.enabled
      ? `"${name}" is enabled`
      : `"${name}" is disabled`,
  }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const targetsSchema = z.object({
  routeId: idSchema,
  modelIds: z
    .array(idSchema)
    .max(
      MAX_ROUTE_TARGETS,
      `A route can have at most ${MAX_ROUTE_TARGETS} targets`
    ),
})

/**
 * Replaces the route's targets with `modelIds`, in that order
 * (position = index). Deletes the existing rows, then inserts the new ones;
 * if the insert fails the previous rows are put back.
 */
export async function setRouteTargets(
  routeId: string,
  modelIds: string[]
): Promise<ActionResult> {
  const me = await requireAdmin()
  const parsed = targetsSchema.safeParse({ routeId, modelIds })
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const { routeId: id, modelIds: ids } = parsed.data
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "A model can only appear once in a route" }
  }

  const db = supabaseAdmin()
  const { data: route, error: routeError } = await db
    .from("routes")
    .select("id, kind, name")
    .eq("id", id)
    .maybeSingle()
  if (routeError) return actionError(routeError)
  if (!route) return { ok: false, error: "Route not found" }
  const routeKind = (route as { kind: string }).kind
  const slugs = new Map<string, string>()

  if (ids.length) {
    const { data: models, error } = await db
      .from("models")
      .select("id, slug, kind, providers(owner_email)")
      .in("id", ids)
    if (error) return actionError(error)
    const found = (models ?? []) as unknown as {
      id: string
      slug: string
      kind: string
      providers: { owner_email: string | null } | null
    }[]
    // Routes are shared by every app; members' own models can't be in one.
    if (found.some((model) => model.providers?.owner_email)) {
      return {
        ok: false,
        error: "Routes can only use models from shared providers",
      }
    }
    if (found.length !== ids.length) {
      return {
        ok: false,
        error:
          "Some of these models no longer exist. Reload the page and try again.",
      }
    }
    const wrongKind = found.find((model) => model.kind !== routeKind)
    if (wrongKind) {
      return {
        ok: false,
        error: `${wrongKind.slug} is ${wrongKind.kind === "embedding" ? "an embedding" : "a chat"} model; this route only takes ${routeKind} models`,
      }
    }
    for (const model of found) slugs.set(model.id, model.slug)
  }

  const { error: replaceError } = await db.rpc("replace_route_targets", {
    p_route: id,
    p_models: ids,
  })
  if (replaceError) return actionError(replaceError)

  const routeName = (route as { name: string }).name
  await audit(
    me.email,
    "route.targets",
    `Changed targets of route '${routeName}'`,
    { type: "route", id, name: routeName },
    { count: ids.length, targets: ids.map((m) => slugs.get(m) ?? m) }
  )
  refresh(id)
  return {
    ok: true,
    message: ids.length
      ? `Saved ${ids.length} target${ids.length === 1 ? "" : "s"}`
      : "All targets removed. Requests to this route will fail until you add one.",
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteRoute(routeId: string): Promise<ActionResult> {
  const me = await requireAdmin()
  const id = idSchema.safeParse(routeId)
  if (!id.success) return { ok: false, error: "Route not found" }

  // route_targets cascade; request_logs.route_id is set to null.
  const { data, error } = await supabaseAdmin()
    .from("routes")
    .delete()
    .eq("id", id.data)
    .select("name")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "Route not found" }

  const name = (data as { name: string }).name
  await audit(me.email, "route.delete", `Deleted route '${name}'`, {
    type: "route",
    id: id.data,
    name,
  })
  refresh()
  return {
    ok: true,
    message: `Route "${name}" deleted`,
  }
}
