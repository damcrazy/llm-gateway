import "server-only"

import { publicFetch } from "@/lib/net/public-fetch"

import type { ProviderRuntime } from "./config"

/**
 * Members' own providers may only reach public https addresses; admins'
 * providers (shared, or kept private) may also use local ones, like Ollama.
 */
export function fetchFor(
  provider: Pick<ProviderRuntime, "publicOnly">
): typeof fetch {
  return provider.publicOnly ? publicFetch : globalThis.fetch
}

/** For AI SDK provider factories: undefined keeps their default fetch. */
export function fetchOption(provider: Pick<ProviderRuntime, "publicOnly">): {
  fetch?: typeof fetch
} {
  return provider.publicOnly ? { fetch: publicFetch } : {}
}
