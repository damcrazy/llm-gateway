import type { PromptMessage } from "@/lib/prompt-template"

export const MAX_COMPARE_MODELS = 4

/** What the Compare page starts with: a replayed request or a library prompt. */
export type ComparePrefill =
  | { source: "error"; error: string }
  | {
      source: "replay" | "prompt"
      label: string
      requestId?: string
      promptId?: string
      promptVersion?: number
      appId: string | null
      model: string | null
      /** For a prompt, these may contain {{variables}}. */
      messages: PromptMessage[]
      variables: string[]
      temperature: number | null
      maxTokens: number | null
      /** A stored payload had long text cut short. */
      truncated: boolean
    }
