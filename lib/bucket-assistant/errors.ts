// Turning a failed assistant turn into a sentence for the chat.

import { ClientAbortError, GatewayError } from "@/lib/gateway/errors"

export function assistantErrorMessage(error: unknown, runsOn: string): string {
  if (error instanceof GatewayError) {
    if (error.status === 400 && /tool/i.test(error.message))
      return `${runsOn} couldn't use the assistant's tools. Try another model in Runs on.`
    return error.message
  }
  if (
    error instanceof ClientAbortError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  )
    return "The assistant took too long. Try again."
  return "Something went wrong. Try again."
}
