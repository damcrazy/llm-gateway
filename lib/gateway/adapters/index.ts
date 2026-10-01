import "server-only"

import type { ProviderType } from "@/lib/providers/catalog"

import { aiSdkAdapter } from "./ai-sdk"
import { openAIAdapter } from "./openai"
import type { ProviderAdapter } from "./types"

const ADAPTERS: Record<ProviderType, ProviderAdapter> = {
  openai_compatible: openAIAdapter,
  azure_openai: openAIAdapter,
  anthropic: aiSdkAdapter,
  bedrock: aiSdkAdapter,
  vertex: aiSdkAdapter,
  google: aiSdkAdapter,
}

export function adapterFor(type: ProviderType): ProviderAdapter {
  return ADAPTERS[type]
}
