export interface SseEvent {
  event?: string
  data: string
}

/** Parses a text/event-stream body into events. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const raw = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const event = parseEvent(raw)
        if (event) yield event
      }
    }
    const event = parseEvent(buffer)
    if (event) yield event
  } finally {
    // Propagates cancellation upstream when the consumer stops early.
    reader.cancel().catch(() => {})
  }
}

function parseEvent(raw: string): SseEvent | undefined {
  let event: string | undefined
  const data: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "data") data.push(value)
    else if (field === "event") event = value
  }
  return data.length ? { event, data: data.join("\n") } : undefined
}

const encoder = new TextEncoder()

export function encodeSse(data: unknown, event?: string): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data)
  return encoder.encode(
    `${event ? `event: ${event}\n` : ""}data: ${payload}\n\n`
  )
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}
