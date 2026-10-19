// Buckets holding more than one model kind (pure, server and client safe).
//
// The router only tries models whose kind matches the request, so in a
// bucket of chat and embedding models a chat request silently skips the
// embedding ones: the fallback chain is shorter than it looks.

import type { ModelKind } from "@/lib/db/types"
import { MODEL_KIND_LABELS } from "@/lib/model-kinds"

export interface KindedModel {
  id: string
  name: string
  kind: ModelKind
}

export interface KindMix {
  /** The first model's kind: the one tried first. */
  primary: ModelKind
  counts: Partial<Record<ModelKind, number>>
  /** Models of any other kind, in bucket order. */
  offKind: KindedModel[]
}

/** null when the bucket holds a single kind (or nothing). */
export function bucketKindMix(models: KindedModel[]): KindMix | null {
  const first = models[0]
  if (!first) return null
  const counts: Partial<Record<ModelKind, number>> = {}
  for (const model of models) counts[model.kind] = (counts[model.kind] ?? 0) + 1
  if (Object.keys(counts).length < 2) return null
  return {
    primary: first.kind,
    counts,
    offKind: models.filter((model) => model.kind !== first.kind),
  }
}

const word = (kind: ModelKind) => MODEL_KIND_LABELS[kind].toLowerCase()
const article = (text: string) => (/^[aeiou]/.test(text) ? "an" : "a")
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)
const models = (count: number, kind: ModelKind) =>
  `${count} ${word(kind)} model${count === 1 ? "" : "s"}`

function list(items: string[]): string {
  if (items.length < 2) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** "Embedding model" */
export function kindModelLabel(kind: ModelKind): string {
  return `${MODEL_KIND_LABELS[kind]} model`
}

export function mixWarningText(
  bucketName: string,
  mix: KindMix
): { title: string; body: string } {
  // Object keys keep insertion order, so kinds appear in bucket order.
  const kinds = Object.keys(mix.counts) as ModelKind[]
  const others = kinds.filter((kind) => kind !== mix.primary)
  const primaryCount = mix.counts[mix.primary] ?? 0
  const offCount = mix.offKind.length
  const title = `This bucket mixes ${list(kinds.map(word))} models`
  const tried = `${capitalize(word(mix.primary))} requests to ${bucketName} only try its ${models(primaryCount, mix.primary)}.`
  const failing =
    primaryCount === 1
      ? `if the ${word(mix.primary)} model fails the request fails`
      : `if the ${word(mix.primary)} models fail the request fails`

  if (others.length === 1) {
    const other = others[0]!
    const skipped = `The ${models(offCount, other)} ${offCount === 1 ? "is" : "are"} skipped, never used as fallbacks, so ${failing}.`
    const move =
      offCount === 1
        ? "Move it into its own bucket."
        : "Move them into their own bucket."
    return {
      title,
      body: `${tried} ${skipped} ${capitalize(word(other))} requests do the reverse. ${move}`,
    }
  }

  const breakdown = others
    .map((kind) => `${mix.counts[kind]} ${word(kind)}`)
    .join(", ")
  return {
    title,
    body: `${tried} The other ${offCount} models (${breakdown}) are skipped, never used as fallbacks, so ${failing}. Other requests only use models of their own kind. Move them into their own buckets.`,
  }
}

/** Shown when a model of another kind is added to a bucket by hand. */
export function offKindToast(
  modelName: string,
  modelKind: ModelKind,
  bucketName: string,
  primary: ModelKind
): string {
  const kind = word(modelKind)
  return `${modelName} is ${article(kind)} ${kind} model. ${capitalize(word(primary))} requests to ${bucketName} will skip it.`
}
