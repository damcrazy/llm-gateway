// What the assistant's Runs on picker offers (pure, server and client safe).

import type { BucketsData } from "@/app/(dashboard)/apps/[id]/buckets-shared"
import { priceTier, type PriceTier } from "@/lib/pricing"

export interface AssistantOptions {
  /** This app's buckets holding at least one chat model. */
  buckets: { name: string }[]
  modelGroups: {
    provider: string
    models: {
      slug: string
      name: string
      tier: PriceTier
      inputPrice: number | null
      outputPrice: number | null
    }[]
  }[]
  /** false: no chat model is marked for tool calling, so all are listed. */
  toolsKnown: boolean
}

const byName = (a: string, b: string) => a.localeCompare(b)

export function buildAssistantOptions(data: BucketsData): AssistantOptions {
  const byId = new Map(data.models.map((model) => [model.id, model]))
  const addable = new Set(data.addable)
  const chat = data.models.filter(
    (model) => model.kind === "chat" && addable.has(model.id)
  )
  const withTools = chat.filter((model) => model.capabilities.includes("tools"))
  const toolsKnown = withTools.length > 0

  const groups = new Map<string, AssistantOptions["modelGroups"][number]>()
  for (const model of toolsKnown ? withTools : chat) {
    const group = groups.get(model.provider) ?? {
      provider: model.provider,
      models: [],
    }
    group.models.push({
      slug: model.slug,
      name: model.name,
      tier: priceTier(model.inputPrice, model.outputPrice),
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
    })
    groups.set(model.provider, group)
  }

  return {
    buckets: data.buckets
      .filter((bucket) =>
        bucket.modelIds.some((id) => byId.get(id)?.kind === "chat")
      )
      .map((bucket) => ({ name: bucket.name })),
    modelGroups: [...groups.values()]
      .sort((a, b) => byName(a.provider, b.provider))
      .map((group) => ({
        ...group,
        models: group.models.sort((a, b) => byName(a.name, b.name)),
      })),
    toolsKnown,
  }
}

export function isAllowedRunsOn(
  options: AssistantOptions,
  runsOn: string
): boolean {
  return (
    options.buckets.some((bucket) => bucket.name === runsOn) ||
    options.modelGroups.some((group) =>
      group.models.some((model) => model.slug === runsOn)
    )
  )
}
