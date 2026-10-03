// Prompt templates: messages with {{variables}}. Shared by the gateway and
// the dashboard editor (no server-only imports).

export type PromptRole = "system" | "user" | "assistant"

export interface PromptMessage {
  role: PromptRole
  content: string
}

/** Defaults a request can override. */
export interface PromptParams {
  temperature?: number
  top_p?: number
  max_tokens?: number
}

export const PROMPT_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g

/** Variable names used in the messages, in order of first use. */
export function promptVariables(messages: PromptMessage[]): string[] {
  const names = new Set<string>()
  for (const message of messages) {
    for (const match of message.content.matchAll(VARIABLE)) names.add(match[1]!)
  }
  return [...names]
}

/** Fills in variables; throws listing the ones that are missing. */
export function renderPrompt(
  messages: PromptMessage[],
  variables: Record<string, string>
): PromptMessage[] {
  const missing = promptVariables(messages).filter(
    (name) => !(name in variables)
  )
  if (missing.length) throw new MissingVariablesError(missing)
  return messages.map((message) => ({
    role: message.role,
    content: message.content.replace(
      VARIABLE,
      (_, name: string) => variables[name] ?? ""
    ),
  }))
}

export class MissingVariablesError extends Error {
  constructor(readonly names: string[]) {
    super(
      `Missing prompt variable${names.length === 1 ? "" : "s"}: ${names.join(", ")}`
    )
  }
}
