import { after } from "next/server"

/**
 * Runs a side effect without delaying the response, while keeping the
 * serverless function alive until it settles (Vercel) or just letting it run
 * (Node / Docker).
 */
export function background(
  task: Promise<unknown> | (() => Promise<unknown>)
): void {
  const promise = (typeof task === "function" ? task() : task).catch(
    (error) => {
      console.error("[gateway] background task failed:", error)
    }
  )
  try {
    after(() => promise)
  } catch {
    // Called outside a request scope; the promise still runs.
  }
}
