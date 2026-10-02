import "server-only"

import { publicFetch } from "@/lib/net/public-fetch"

import type { ProviderRuntime } from "./config"

/**
 * Members' own providers may only reach public https addresses; shared
 * providers (set up by admins) may also use local ones, like Ollama.
 */
export function fetchFor(
  provider: Pick<ProviderRuntime, "ownerEmail">
): typeof fetch {
  return provider.ownerEmail ? publicFetch : globalThis.fetch
}

/** For AI SDK provider factories: undefined keeps their default fetch. */
export function fetchOption(provider: Pick<ProviderRuntime, "ownerEmail">): {
  fetch?: typeof fetch
} {
  return provider.ownerEmail ? { fetch: publicFetch } : {}
}
