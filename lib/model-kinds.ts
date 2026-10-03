import type { MediaKind, ModelKind } from "@/lib/db/types"

export const MODEL_KINDS = [
  "chat",
  "embedding",
  "image",
  "speech",
  "transcription",
  "rerank",
] as const satisfies readonly ModelKind[]

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
  image: "Image",
  speech: "Speech",
  transcription: "Transcription",
  rerank: "Rerank",
}

/** What a media model's unit price is per. */
export const UNIT_PRICE_LABELS: Record<MediaKind, string> = {
  image: "per image",
  speech: "per 1K characters",
  transcription: "per minute of audio",
  rerank: "per search",
}

export const ENDPOINT_FOR_KIND: Record<ModelKind, string> = {
  chat: "/v1/chat/completions",
  embedding: "/v1/embeddings",
  image: "/v1/images/generations",
  speech: "/v1/audio/speech",
  transcription: "/v1/audio/transcriptions",
  rerank: "/v1/rerank",
}

export function isMediaKind(kind: ModelKind): kind is MediaKind {
  return kind in UNIT_PRICE_LABELS
}
