"use server"

import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireAdmin } from "@/lib/auth"
import {
  runPlayground,
  type PlaygroundRequest,
  type PlaygroundResult,
} from "@/lib/gateway/playground"

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
})

/** Runs one chat turn through the real gateway pipeline (routing, fallback, logging). */
export async function sendPlaygroundMessage(
  input: PlaygroundRequest
): Promise<ActionResult<PlaygroundResult>> {
  const me = await requireAdmin()
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

  try {
    const result = await runPlayground({ ...parsed.data, ownerEmail: me.email })
    return { ok: true, data: result }
  } catch (error) {
    return actionError(error)
  }
}
