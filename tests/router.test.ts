import { describe, expect, test } from "bun:test"

import { accessPolicy } from "@/lib/access"
import { GatewayError } from "@/lib/gateway/errors"
import { listAvailableModels, resolveModel } from "@/lib/gateway/router"
import type { ChatRequest } from "@/lib/gateway/types"

import { app, model, provider, route, snapshot } from "./helpers"

const groq = provider({ slug: "groq" })
const openrouter = provider({ slug: "openrouter" })
const fast = model(groq, "llama-3.3-70b", { capabilities: ["tools"] })
const vision = model(openrouter, "gpt-4o", {
  capabilities: ["tools", "vision"],
})
const small = model(openrouter, "tiny", {
  capabilities: [],
  context_window: 100,
})

const chat = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "smart",
  messages: [{ role: "user", content: "hi" }],
  ...extra,
})

describe("resolveModel", () => {
  test("route targets are tried in order", () => {
    const snap = snapshot([fast, vision], [route("smart", [fast, vision])])
    const result = resolveModel(snap, "smart", "chat", null, chat())
    expect(result.candidates.map((m) => m.slug)).toEqual([
      "groq/llama-3.3-70b",
      "openrouter/gpt-4o",
    ])
    expect(result.route?.name).toBe("smart")
  })

  test("a model slug resolves directly", () => {
    const snap = snapshot([fast, vision])
    const result = resolveModel(snap, "openrouter/gpt-4o", "chat", null, chat())
    expect(result.candidates).toEqual([vision])
    expect(result.maxAttempts).toBe(2) // one retry for transient errors
  })

  test("a bare upstream id matches every provider serving it", () => {
    const again = model(groq, "gpt-4o")
    const snap = snapshot([vision, again])
    const result = resolveModel(snap, "gpt-4o", "chat", null, chat())
    expect(result.candidates.length).toBe(2)
  })

  test("image requests skip models without vision", () => {
    const snap = snapshot([fast, vision], [route("smart", [fast, vision])])
    const request = chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://x/y.png" } },
          ],
        },
      ],
    })
    const result = resolveModel(snap, "smart", "chat", null, request)
    expect(result.candidates).toEqual([vision])
  })

  test("falls back to all targets when none has the capability", () => {
    const snap = snapshot([fast], [route("smart", [fast])])
    const request = chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://x/y.png" } },
          ],
        },
      ],
    })
    const result = resolveModel(snap, "smart", "chat", null, request)
    expect(result.candidates).toEqual([fast])
    expect(result.notes.length).toBe(1)
  })

  test("skips models whose context window is too small", () => {
    const snap = snapshot([small, fast], [route("smart", [small, fast])])
    const result = resolveModel(
      snap,
      "smart",
      "chat",
      null,
      chat({ messages: [{ role: "user", content: "x".repeat(2000) }] })
    )
    expect(result.candidates).toEqual([fast])
  })

  test("models in cooldown go last", () => {
    const snap = snapshot([fast, vision], [route("smart", [fast, vision])])
    snap.health.set(fast.id, {
      cooldownUntil: Date.now() + 60_000,
      failures: 1,
      updatedAt: Date.now(),
    })
    const result = resolveModel(snap, "smart", "chat", null, chat())
    expect(result.candidates).toEqual([vision, fast])
  })

  test("disabled providers are excluded", () => {
    const offline = provider({ slug: "offline", enabled: false })
    const down = model(offline, "m")
    const snap = snapshot([down, fast], [route("smart", [down, fast])])
    expect(
      resolveModel(snap, "smart", "chat", null, chat()).candidates
    ).toEqual([fast])
  })

  test("app default model is used when model is missing or 'default'", () => {
    const snap = snapshot([fast], [route("smart", [fast])])
    const a = app({ default_model: "smart" })
    expect(
      resolveModel(snap, "default", "chat", a, chat()).requestedModel
    ).toBe("smart")
    expect(resolveModel(snap, "", "chat", a, chat()).requestedModel).toBe(
      "smart"
    )
  })

  test("allowed_models restricts what an app can call", () => {
    const snap = snapshot([fast, vision], [route("smart", [fast, vision])])
    const a = app({ allowed_models: ["groq/llama-3.3-70b"] })
    expect(() =>
      resolveModel(snap, "openrouter/gpt-4o", "chat", a, chat())
    ).toThrow(GatewayError)
    // A route not in the list is narrowed to allowed targets.
    expect(resolveModel(snap, "smart", "chat", a, chat()).candidates).toEqual([
      fast,
    ])
  })

  test("unknown models are a 404", () => {
    try {
      resolveModel(snapshot([fast]), "nope", "chat", null, chat())
      throw new Error("expected to throw")
    } catch (error) {
      expect((error as GatewayError).status).toBe(404)
    }
  })

  test("round robin rotates the starting target", () => {
    const r = route("rr", [fast, vision], { strategy: "round_robin" })
    const snap = snapshot([fast, vision], [r])
    const first = resolveModel(snap, "rr", "chat", null, chat()).candidates[0]
    const second = resolveModel(snap, "rr", "chat", null, chat()).candidates[0]
    expect(first).not.toBe(second)
  })

  describe("member access policies", () => {
    const openrouterFree = model(openrouter, "llama:free", {
      input_price_per_mtok: 0,
      output_price_per_mtok: 0,
    })
    const unknownPrice = model(groq, "mystery", {
      input_price_per_mtok: null,
      output_price_per_mtok: null,
    })
    const mixed = route("mixed", [fast, openrouterFree, unknownPrice])
    const snap = snapshot([fast, vision, openrouterFree, unknownPrice], [mixed])
    const member = (
      model_access: "all" | "free" | "allowlist",
      allowed: string[] = []
    ) => accessPolicy({ role: "member", model_access, allowed_models: allowed })

    test("free-only keeps just the $0 targets of a route", () => {
      const result = resolveModel(
        snap,
        "mixed",
        "chat",
        null,
        chat(),
        member("free")
      )
      expect(result.candidates).toEqual([openrouterFree])
    })

    test("free-only rejects a paid model slug", () => {
      expect(() =>
        resolveModel(
          snap,
          "groq/llama-3.3-70b",
          "chat",
          null,
          chat(),
          member("free")
        )
      ).toThrow(/free models only/)
    })

    test("allow-list admits a listed route and all its targets", () => {
      const result = resolveModel(
        snap,
        "mixed",
        "chat",
        null,
        chat(),
        member("allowlist", ["mixed"])
      )
      expect(result.candidates.length).toBe(3)
    })

    test("allow-list admits listed models only", () => {
      const policy = member("allowlist", ["openrouter/gpt-4o"])
      expect(
        resolveModel(snap, "openrouter/gpt-4o", "chat", null, chat(), policy)
          .candidates
      ).toEqual([vision])
      expect(() =>
        resolveModel(snap, "mixed", "chat", null, chat(), policy)
      ).toThrow(GatewayError)
    })

    test("admins are never restricted", () => {
      const admin = accessPolicy({
        role: "admin",
        model_access: "free",
        allowed_models: [],
      })
      expect(
        resolveModel(snap, "mixed", "chat", null, chat(), admin).candidates
          .length
      ).toBe(3)
    })

    test("/v1/models lists only what the policy allows", () => {
      const ids = listAvailableModels(snap, null, member("free")).map(
        (m) => m.id
      )
      expect(ids).toEqual(["mixed", "openrouter/llama:free"])
    })
  })
})
