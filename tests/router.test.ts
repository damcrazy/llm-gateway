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

  test("an app's bucket is tried in its order, in full", () => {
    const third = model(groq, "mixtral")
    const snap = snapshot([fast, vision, third])
    const a = app({
      buckets: [{ name: "smart", model_ids: [vision.id, third.id, fast.id] }],
    })
    const result = resolveModel(snap, "smart", "chat", a, chat())
    expect(result.bucket?.name).toBe("smart")
    expect(result.candidates).toEqual([vision, third, fast])
    expect(result.maxAttempts).toBe(3)
  })

  test("a bucket wins over a global route with the same name", () => {
    const snap = snapshot([fast, vision], [route("smart", [fast])])
    const a = app({ buckets: [{ name: "smart", model_ids: [vision.id] }] })
    const result = resolveModel(snap, "smart", "chat", a, chat())
    expect(result.route).toBeUndefined()
    expect(result.candidates).toEqual([vision])
    // Other apps still get the route.
    expect(resolveModel(snap, "smart", "chat", app(), chat()).route?.name).toBe(
      "smart"
    )
  })

  test("the default can be a bucket", () => {
    const snap = snapshot([fast, vision])
    const a = app({
      default_model: "cheap",
      buckets: [{ name: "cheap", model_ids: [fast.id] }],
    })
    const result = resolveModel(snap, "", "chat", a, chat())
    expect(result.bucket?.name).toBe("cheap")
    expect(result.candidates).toEqual([fast])
  })

  test("an empty bucket is a clear 503", () => {
    const a = app({ buckets: [{ name: "smart", model_ids: [] }] })
    try {
      resolveModel(snapshot([fast]), "smart", "chat", a, chat())
      throw new Error("expected to throw")
    } catch (error) {
      expect((error as GatewayError).status).toBe(503)
      expect((error as GatewayError).message).toContain("no models yet")
    }
  })

  test("only_bucket_models limits an app to its buckets and their models", () => {
    const snap = snapshot([fast, vision], [route("global", [fast, vision])])
    const a = app({
      only_bucket_models: true,
      buckets: [{ name: "smart", model_ids: [fast.id] }],
    })
    expect(resolveModel(snap, "smart", "chat", a, chat()).candidates).toEqual([
      fast,
    ])
    // A model inside a bucket may be called directly…
    expect(
      resolveModel(snap, "groq/llama-3.3-70b", "chat", a, chat()).candidates
    ).toEqual([fast])
    // …but nothing else, and routes are narrowed to bucket models.
    expect(() =>
      resolveModel(snap, "openrouter/gpt-4o", "chat", a, chat())
    ).toThrow(GatewayError)
    expect(resolveModel(snap, "global", "chat", a, chat()).candidates).toEqual([
      fast,
    ])
  })

  test("a bucket can't reach models its owner isn't allowed to use", () => {
    const free = model(groq, "free-one", {
      input_price_per_mtok: 0,
      output_price_per_mtok: 0,
    })
    const snap = snapshot([vision, free])
    const a = app({
      buckets: [{ name: "smart", model_ids: [vision.id, free.id] }],
    })
    const policy = accessPolicy({
      role: "member",
      model_access: "free",
      allowed_models: [],
    })
    expect(
      resolveModel(snap, "smart", "chat", a, chat(), policy).candidates
    ).toEqual([free])
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

  describe("/v1/models with buckets", () => {
    test("buckets come first, named after their chain", () => {
      const snap = snapshot([fast, vision], [route("global", [fast])])
      const a = app({
        buckets: [{ name: "smart", model_ids: [vision.id, fast.id] }],
      })
      const entries = listAvailableModels(snap, a)
      expect(entries[0]?.id).toBe("smart")
      expect(entries[0]?.displayName).toBe("smart: gpt-4o → llama-3.3-70b")
      expect(entries.map((e) => e.id)).toContain("global")
    })

    test("only_bucket_models lists just buckets and their models", () => {
      const snap = snapshot([fast, vision], [route("global", [fast])])
      const a = app({
        only_bucket_models: true,
        buckets: [{ name: "smart", model_ids: [fast.id] }],
      })
      expect(listAvailableModels(snap, a).map((e) => e.id)).toEqual([
        "smart",
        "groq/llama-3.3-70b",
      ])
    })
  })

  describe("private providers", () => {
    const mine = provider({ slug: "my-openai", ownerEmail: "me@example.com" })
    const theirs = provider({
      slug: "their-openai",
      ownerEmail: "them@example.com",
    })
    const myModel = model(mine, "gpt-4o", {
      input_price_per_mtok: 2.5,
      output_price_per_mtok: 10,
    })
    const theirModel = model(theirs, "gpt-4o", {
      input_price_per_mtok: 2.5,
      output_price_per_mtok: 10,
    })
    const shared = model(groq, "shared-free", {
      input_price_per_mtok: 0,
      output_price_per_mtok: 0,
    })
    const snap = snapshot(
      [myModel, theirModel, shared],
      [route("global", [theirModel, shared])]
    )
    const myApp = app({ owner_email: "me@example.com" })
    const freeOnly = accessPolicy({
      role: "member",
      model_access: "free",
      allowed_models: [],
    })

    test("the owner can call their own paid model even on a free-only plan", () => {
      expect(
        resolveModel(snap, "my-openai/gpt-4o", "chat", myApp, chat(), freeOnly)
          .candidates
      ).toEqual([myModel])
    })

    test("another member's model is a plain 404", () => {
      try {
        resolveModel(snap, "their-openai/gpt-4o", "chat", myApp, chat())
        throw new Error("expected to throw")
      } catch (error) {
        expect((error as GatewayError).status).toBe(404)
      }
    })

    test("upstream ids only match visible models", () => {
      expect(
        resolveModel(snap, "gpt-4o", "chat", myApp, chat()).candidates
      ).toEqual([myModel])
    })

    test("routes and buckets skip other members' private models", () => {
      expect(
        resolveModel(snap, "global", "chat", myApp, chat()).candidates
      ).toEqual([shared])
      const sneaky = app({
        owner_email: "me@example.com",
        buckets: [{ name: "b", model_ids: [theirModel.id, myModel.id] }],
      })
      expect(
        resolveModel(snap, "b", "chat", sneaky, chat()).candidates
      ).toEqual([myModel])
    })

    test("without the owner (an admin running the app) private models are hidden", () => {
      expect(() =>
        resolveModel(
          snap,
          "my-openai/gpt-4o",
          "chat",
          myApp,
          chat(),
          { access: "all" },
          null
        )
      ).toThrow(GatewayError)
    })

    test("/v1/models shows your own private models, not anyone else's", () => {
      const ids = listAvailableModels(snap, myApp, freeOnly).map((m) => m.id)
      expect(ids).toContain("my-openai/gpt-4o")
      expect(ids).not.toContain("their-openai/gpt-4o")
      expect(ids).toContain("groq/shared-free")
    })
  })

  describe("bucket strategies and quotas", () => {
    const pricey = model(groq, "pricey", {
      input_price_per_mtok: 5,
      output_price_per_mtok: 15,
    })
    const cheap = model(groq, "cheap", {
      input_price_per_mtok: 0.1,
      output_price_per_mtok: 0.2,
    })
    const unknown = model(groq, "unknown", {
      input_price_per_mtok: null,
      output_price_per_mtok: null,
    })
    const bucketApp = (
      strategy: "ordered" | "fastest" | "cheapest" | "spread",
      ids: string[],
      hedge: number | null = null
    ) =>
      app({
        buckets: [
          { name: "b", model_ids: ids, strategy, hedge_after_ms: hedge },
        ],
      })

    test("cheapest orders by price, unknown prices last", () => {
      const snap = snapshot([unknown, pricey, cheap])
      const a = bucketApp("cheapest", [unknown.id, pricey.id, cheap.id])
      expect(resolveModel(snap, "b", "chat", a, chat()).candidates).toEqual([
        cheap,
        pricey,
        unknown,
      ])
    })

    test("fastest uses recent first-token times; too few samples rank as average", () => {
      const snap = snapshot([pricey, cheap, unknown])
      snap.latency.set(pricey.id, { firstMs: 300, samples: 10 })
      snap.latency.set(cheap.id, { firstMs: 900, samples: 10 })
      snap.latency.set(unknown.id, { firstMs: 50, samples: 1 })
      const a = bucketApp("fastest", [cheap.id, unknown.id, pricey.id])
      // unknown has 1 sample -> treated as the median (900): ties keep order.
      expect(resolveModel(snap, "b", "chat", a, chat()).candidates).toEqual([
        pricey,
        cheap,
        unknown,
      ])
    })

    test("spread rotates the first model between requests", () => {
      const snap = snapshot([pricey, cheap])
      const a = bucketApp("spread", [pricey.id, cheap.id])
      const first = resolveModel(snap, "b", "chat", a, chat()).candidates[0]
      const second = resolveModel(snap, "b", "chat", a, chat()).candidates[0]
      expect(first).not.toBe(second)
    })

    test("hedging is passed to the executor", () => {
      const snap = snapshot([pricey, cheap])
      const a = bucketApp("ordered", [pricey.id, cheap.id], 2000)
      expect(resolveModel(snap, "b", "chat", a, chat()).hedgeAfterMs).toBe(2000)
    })

    test("a model over its free-tier quota is skipped", () => {
      const capped = model(groq, "capped", { quota_rpm: 2 })
      const snap = snapshot([capped, cheap])
      snap.quotaUsage.set(`model:${capped.id}:minute`, 2)
      const a = bucketApp("ordered", [capped.id, cheap.id])
      expect(resolveModel(snap, "b", "chat", a, chat()).candidates).toEqual([
        cheap,
      ])
    })

    test("every model over quota is a 429 with Retry-After", () => {
      const capped = model(openrouter, "daily", { quota_rpd: 50 })
      const snap = snapshot([capped])
      snap.quotaUsage.set(`model:${capped.id}:day`, 50)
      try {
        resolveModel(snap, "openrouter/daily", "chat", null, chat())
        throw new Error("expected to throw")
      } catch (error) {
        const e = error as GatewayError
        expect(e.status).toBe(429)
        expect(e.message).toContain("requests/day")
        expect(Number(e.headers?.["Retry-After"])).toBeGreaterThan(0)
      }
    })
  })
})
