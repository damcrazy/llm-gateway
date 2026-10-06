import "server-only"

import type { AccessPolicy } from "@/lib/access"
import type { GatewayApp, MediaKind, ModelKind } from "@/lib/db/types"

import {
  cacheKey,
  collectStream,
  completionToChunks,
  isCacheable,
  readCache,
  writeCache,
  type CacheOptions,
} from "./cache"
import { adapterFor } from "./adapters"
import type { MediaPath } from "./adapters/types"
import { getSnapshot, type GatewaySnapshot, type ModelRuntime } from "./config"
import {
  embeddingInputCount,
  embeddingsProblem,
  estimateEmbeddingTokens,
  normalizeEmbeddings,
  reportedEmbeddingTokens,
} from "./embeddings-check"
import {
  ClientAbortError,
  GatewayError,
  UpstreamError,
  toUpstreamError,
} from "./errors"
import { decideOnFailure, recordFailure, recordSuccess } from "./health"
import { checkStructuredOutput, structuredFormat } from "./json-guard"
import { applyPrompt, loadPrompt, type PromptRef } from "./prompts"
import { describePii, scrubChatRequest, scrubText, type PiiKind } from "./pii"
import { noteProviderCall } from "./quota"
import type { RequestRecorder } from "./recorder"
import { resolveModel, type Resolution } from "./router"
import type {
  ChatChunk,
  ChatCompletion,
  ChatRequest,
  EmbeddingsRequest,
  EmbeddingsResponse,
  Usage,
} from "./types"
import { estimateRequestTokens, estimateTokens, usageFromChat } from "./usage"

interface AttemptContext {
  signal: AbortSignal
  abort(reason: unknown): void
  /** Keep the timeout and client-abort link alive after the attempt returns; call the result when done. */
  hold(): () => void
}

type Attempt<T> = (model: ModelRuntime, ctx: AttemptContext) => Promise<T>

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * Tries candidates in order until one succeeds. Failed models are put into
 * cooldown (shared across instances) so later requests skip them, and the
 * caller never sees the individual failures unless every attempt fails.
 */
class HedgeCancelled extends Error {
  constructor() {
    super("Cancelled: another model answered first")
  }
}

type Outcome<T> =
  | {
      ok: true
      model: ModelRuntime
      value: T
      started: number
      attemptStart: number
      held: boolean
      release: () => void
    }
  | {
      ok: false
      model: ModelRuntime
      error: unknown
      upstream: UpstreamError
      started: number
      attemptStart: number
    }

interface Running<T> {
  model: ModelRuntime
  result: Promise<Outcome<T>>
  cancel(): void
}

/**
 * Tries candidates in order until one succeeds. Failed models are put into
 * cooldown (shared across instances) so later requests skip them, and the
 * caller never sees the individual failures unless every attempt fails.
 *
 * With hedging (a bucket's hedge_after_ms), when a model hasn't answered in
 * time the next one starts too; the first to answer wins and the other is
 * cancelled without counting against its health.
 */
async function withFailover<T>(
  snapshot: GatewaySnapshot,
  resolution: Resolution,
  recorder: RequestRecorder,
  clientSignal: AbortSignal,
  attempt: Attempt<T>,
  /** Clean up a successful result that lost a hedged race. */
  discard: (value: T) => void = () => {}
): Promise<{ value: T; model: ModelRuntime }> {
  const queue = [...resolution.candidates]
  const retried = new Set<string>()
  let lastError: UpstreamError | undefined
  let lastTransient: ModelRuntime | undefined

  function start(model: ModelRuntime): Running<T> {
    noteProviderCall(snapshot, model)
    const started = Date.now()
    const attemptStart = recorder.attemptStarted()
    const controller = new AbortController()
    const onClientAbort = () => controller.abort(new ClientAbortError())
    clientSignal.addEventListener("abort", onClientAbort, { once: true })
    const timer = setTimeout(
      () =>
        controller.abort(
          new UpstreamError(
            `Upstream timed out after ${resolution.timeoutMs / 1000}s`,
            null,
            { kind: "timeout" }
          )
        ),
      resolution.timeoutMs
    )
    let held = false
    const release = () => {
      clearTimeout(timer)
      clientSignal.removeEventListener("abort", onClientAbort)
    }
    const result = attempt(model, {
      signal: controller.signal,
      abort: (reason) => controller.abort(reason),
      hold: () => {
        held = true
        return release
      },
    }).then(
      (value): Outcome<T> => {
        if (!held) release()
        return { ok: true, model, value, started, attemptStart, held, release }
      },
      (error): Outcome<T> => {
        release()
        const reason = controller.signal.aborted
          ? controller.signal.reason
          : error
        return {
          ok: false,
          model,
          error: reason ?? error,
          upstream: toUpstreamError(
            reason instanceof UpstreamError ? reason : error
          ),
          started,
          attemptStart,
        }
      }
    )
    return {
      model,
      result,
      cancel: () => controller.abort(new HedgeCancelled()),
    }
  }

  function succeed(outcome: Extract<Outcome<T>, { ok: true }>) {
    // A held attempt is a stream that has produced its first chunk.
    recorder.attemptSucceeded(outcome.attemptStart, outcome.held)
    recordSuccess(outcome.model, snapshot)
    recorder.attempts.push({
      model_id: outcome.model.id,
      model: outcome.model.slug,
      provider: outcome.model.provider.name,
      status: 200,
      latency_ms: Date.now() - outcome.started,
    })
    recorder.served = outcome.model
    return { value: outcome.value, model: outcome.model }
  }

  /** Logs a cancelled hedge loser; never held against the model's health. */
  function dropLoser(outcome: Outcome<T>) {
    if (outcome.ok) {
      outcome.release()
      discard(outcome.value)
    }
    recorder.attempts.push({
      model_id: outcome.model.id,
      model: outcome.model.slug,
      provider: outcome.model.provider.name,
      status: null,
      error: "Cancelled: another model answered first",
      latency_ms: Date.now() - outcome.started,
    })
  }

  /** Records a real failure; returns whether to try another model. */
  function fail(outcome: Extract<Outcome<T>, { ok: false }>): boolean {
    if (clientSignal.aborted || outcome.error instanceof ClientAbortError)
      throw new ClientAbortError()
    recorder.attemptFailed(outcome.attemptStart)
    const decision = decideOnFailure(
      snapshot,
      outcome.model.id,
      outcome.upstream
    )
    recordFailure(
      outcome.model,
      snapshot,
      outcome.upstream,
      decision.cooldownSeconds
    )
    recorder.attempts.push({
      model_id: outcome.model.id,
      model: outcome.model.slug,
      provider: outcome.model.provider.name,
      status: outcome.upstream.status,
      error: outcome.upstream.message.slice(0, 500),
      latency_ms: Date.now() - outcome.started,
      ...(decision.cooldownSeconds
        ? { cooldown_s: decision.cooldownSeconds }
        : {}),
    })
    lastError = outcome.upstream
    if (decision.transient) lastTransient = outcome.model
    return decision.failover
  }

  for (let i = 0; i < resolution.maxAttempts; i++) {
    let model = queue.shift()
    if (!model && lastTransient && !retried.has(lastTransient.id)) {
      // Every candidate failed; give a transiently failing one a second chance.
      retried.add(lastTransient.id)
      model = lastTransient
      const waitStart = performance.now()
      await sleep(400, clientSignal)
      recorder.addSpan("retry_wait", performance.now() - waitStart)
    }
    if (!model) break
    if (clientSignal.aborted) throw new ClientAbortError()

    const primary = start(model)
    const hedgeMs = resolution.hedgeAfterMs
    const backupModel =
      hedgeMs && queue.length && i + 1 < resolution.maxAttempts
        ? queue[0]
        : undefined

    if (!backupModel) {
      const outcome = await primary.result
      if (outcome.ok) return succeed(outcome)
      if (!fail(outcome)) break
      continue
    }

    // Hedged: give the primary a head start, then race it with the backup.
    let timer: ReturnType<typeof setTimeout> | undefined
    const headStart = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), hedgeMs)
    })
    const early = await Promise.race([primary.result, headStart])
    clearTimeout(timer)
    if (early) {
      if (early.ok) return succeed(early)
      if (!fail(early)) break
      continue
    }

    queue.shift()
    i++
    const backup = start(backupModel)
    const runners = [primary, backup]
    const pending = new Map(runners.map((r) => [r, r.result] as const))
    while (pending.size) {
      const [runner, outcome] = await Promise.race(
        [...pending].map(([r, p]) => p.then((o) => [r, o] as const))
      )
      pending.delete(runner)
      if (outcome.ok) {
        for (const [other, result] of pending) {
          other.cancel()
          void result.then(dropLoser)
        }
        return succeed(outcome)
      }
      if (outcome.error instanceof HedgeCancelled) continue
      if (!fail(outcome) && pending.size === 0) {
        throw finalError(lastError, recorder)
      }
    }
  }

  throw finalError(lastError, recorder)
}

function finalError(
  lastError: UpstreamError | undefined,
  recorder: RequestRecorder
): GatewayError {
  const attempts = recorder.attempts
  if (!lastError) {
    return new GatewayError(
      503,
      "No models were available to serve this request.",
      "no_available_models"
    )
  }
  if (attempts.length && attempts.every((a) => a.status === 429)) {
    const cooldowns = attempts.map((a) => a.cooldown_s ?? 60)
    return new GatewayError(
      429,
      `Every model for '${recorder.requestedModel}' is rate limited. Last error: ${lastError.message}`,
      "rate_limit_exceeded",
      "rate_limit_error",
      { "Retry-After": String(Math.min(...cooldowns)) }
    )
  }
  const last = attempts.at(-1)
  const where = last ? ` (${last.provider} · ${last.model})` : ""
  if (lastError.kind === "mismatch") {
    return new GatewayError(
      502,
      `No model returned what the request asked for. Last${where}: ${lastError.message}`,
      "upstream_response_mismatch"
    )
  }
  if (lastError.kind === "output") {
    return new GatewayError(
      502,
      `No model returned output matching the requested format. Last${where}: ${lastError.message.replace(/^Invalid output: /, "")}`,
      "invalid_structured_output"
    )
  }
  if (lastError.status && [400, 413, 422].includes(lastError.status)) {
    return new GatewayError(
      lastError.status,
      `The upstream model rejected the request${where}: ${lastError.message}`,
      "upstream_invalid_request"
    )
  }
  return new GatewayError(
    502,
    `All ${attempts.length} upstream attempt(s) failed. Last error${where}: ${lastError.message}`,
    "upstream_error"
  )
}

/**
 * Fails the attempt (and aborts it) if a stream has not produced its first
 * chunk in time, counting from the request, so a provider that hangs before
 * sending headers is caught too.
 */
function firstTokenDeadline(timeoutMs: number, ctx: AttemptContext) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new UpstreamError(
        `No response within ${timeoutMs / 1000}s`,
        null,
        { kind: "timeout" }
      )
      ctx.abort(error)
      reject(error)
    }, timeoutMs)
  })
  expired.catch(() => {})
  return {
    race: <T>(promise: Promise<T>) => Promise.race([promise, expired]),
    clear: () => clearTimeout(timer),
  }
}

async function* resume(
  first: ChatChunk,
  iterator: AsyncIterator<ChatChunk>,
  release: () => void,
  onProviderDone: () => void
): AsyncGenerator<ChatChunk> {
  try {
    yield first
    while (true) {
      const next = await iterator.next()
      if (next.done) {
        onProviderDone()
        return
      }
      yield next.value
    }
  } finally {
    onProviderDone()
    release()
    await iterator.return?.().catch(() => {})
  }
}

type ChatOutput =
  | { type: "json"; completion: ChatCompletion }
  | { type: "stream"; chunks: AsyncGenerator<ChatChunk> }

export type ChatExecution = ChatOutput & { model: ModelRuntime }

function piiError(found: PiiKind[]) {
  return new GatewayError(
    400,
    `This app doesn't accept prompts containing ${describePii(found)}. Remove it and try again.`,
    "pii_detected"
  )
}

/** Applies the app's PII setting: unchanged, scrubbed, or refused. */
function protectChat(
  app: GatewayApp | null,
  request: ChatRequest,
  recorder: RequestRecorder
): ChatRequest {
  const mode = app?.pii_mode ?? "off"
  if (mode === "off") return request
  const { request: scrubbed, found } = scrubChatRequest(request)
  if (!found.length) return request
  recorder.piiFound = found
  if (mode === "block") throw piiError(found)
  return scrubbed
}

/** Scrubs (or refuses) plain texts per the app's PII setting. */
export function protectTexts(
  app: GatewayApp | null,
  texts: string[],
  recorder: RequestRecorder
): string[] {
  const mode = app?.pii_mode ?? "off"
  if (mode === "off") return texts
  const found = new Set<PiiKind>()
  const scrubbed = texts.map((text) => scrubText(text, found))
  if (!found.size) return texts
  recorder.piiFound = [...found]
  if (mode === "block") throw piiError([...found])
  return scrubbed
}

function protectEmbeddings(
  app: GatewayApp | null,
  request: EmbeddingsRequest,
  recorder: RequestRecorder
): EmbeddingsRequest {
  const mode = app?.pii_mode ?? "off"
  if (mode === "off") return request
  const found = new Set<PiiKind>()
  const scrub = (item: unknown) =>
    typeof item === "string" ? scrubText(item, found) : item
  const input = Array.isArray(request.input)
    ? (request.input as unknown[]).map(scrub)
    : scrub(request.input)
  if (!found.size) return request
  recorder.piiFound = [...found]
  if (mode === "block") throw piiError([...found])
  return { ...request, input: input as EmbeddingsRequest["input"] }
}

export async function executeChat(options: {
  request: ChatRequest
  app: GatewayApp | null
  policy?: AccessPolicy
  /** Whose private providers may be used (default: the app's owner). */
  privateOwner?: string | null
  /** The app's response cache, when it has one. */
  cache?: CacheOptions
  /** A prompt from the library to put first (the request's `prompt`). */
  prompt?: PromptRef | null
  signal: AbortSignal
  recorder: RequestRecorder
}): Promise<ChatExecution> {
  const { recorder } = options
  let base = options.request
  if (options.prompt) {
    const owner = options.app?.owner_email ?? options.privateOwner
    if (!owner)
      throw new GatewayError(
        400,
        "Prompts from the library need an app (its owner's prompts are used).",
        "invalid_prompt"
      )
    const template = await loadPrompt(owner, options.prompt)
    base = applyPrompt(base, template, options.prompt.variables)
    recorder.promptId = template.promptId
    recorder.promptVersion = template.version
  }
  if (!base.messages?.length)
    throw new GatewayError(
      400,
      "`messages` must be a non-empty array.",
      "invalid_request"
    )
  const request = protectChat(options.app, base, recorder)
  recorder.requestedModel = request.model || undefined
  recorder.stream = Boolean(request.stream)
  const snapshot = await getSnapshot()
  const resolution = resolveModel(
    snapshot,
    request.model,
    "chat",
    options.app,
    request,
    options.policy,
    options.privateOwner === undefined
      ? (options.app?.owner_email ?? null)
      : options.privateOwner
  )
  recorder.requestedModel = resolution.requestedModel
  recorder.route = resolution.route

  // Looked up after routing, so a stored answer never bypasses access rules.
  const cache =
    options.cache && isCacheable(request) ? options.cache : undefined
  const key = cache
    ? cacheKey({ ...request, model: resolution.requestedModel })
    : ""
  if (cache) {
    recorder.cacheStatus = cache.read ? "MISS" : "BYPASS"
    if (cache.read) {
      const lookupStart = performance.now()
      const hit = await readCache(cache.appId, key)
      recorder.addSpan("cache", performance.now() - lookupStart)
      const model =
        hit &&
        ((hit.modelId && snapshot.models.get(hit.modelId)) ||
          resolution.candidates[0])
      if (hit && model) {
        recorder.cacheStatus = "HIT"
        recorder.served = model
        return request.stream
          ? {
              type: "stream",
              chunks: completionToChunks(hit.completion),
              model,
            }
          : { type: "json", completion: hit.completion, model }
      }
    }
  }

  // Streams can't be checked before they reach the client.
  const guard =
    options.app?.json_guard && !request.stream
      ? structuredFormat(request)
      : null

  const failover = await withFailover(
    snapshot,
    resolution,
    recorder,
    options.signal,
    async (candidate, ctx): Promise<ChatOutput> => {
      const adapter = adapterFor(candidate.provider.type)
      const call = adapter.chat(
        { ...request, model: candidate.model_id },
        { model: candidate, signal: ctx.signal }
      )
      if (!request.stream) {
        const result = await call
        if (result.type !== "json")
          throw new UpstreamError("Expected a JSON response", 502)
        if (!guard) return result
        const checked = checkStructuredOutput(result.completion, guard)
        if (!checked.ok)
          throw new UpstreamError(`Invalid output: ${checked.problem}`, null, {
            kind: "output",
          })
        return { type: "json", completion: checked.completion }
      }

      // Only commit to this model once it has produced its first chunk.
      const deadline = firstTokenDeadline(resolution.firstTokenTimeoutMs, ctx)
      let iterator: AsyncIterator<ChatChunk> | undefined
      try {
        const result = await deadline.race(call)
        if (result.type === "json") return result
        iterator = result.chunks[Symbol.asyncIterator]()
        const first = await deadline.race(iterator.next())
        if (first.done) {
          throw new UpstreamError(
            "Upstream stream ended without any data",
            502,
            { kind: "stream" }
          )
        }
        recorder.ttftMs = Date.now() - recorder.startedAt
        return {
          type: "stream",
          chunks: resume(first.value, iterator, ctx.hold(), () =>
            recorder.providerDone()
          ),
        }
      } catch (error) {
        void iterator?.return?.().catch(() => {})
        throw error
      } finally {
        deadline.clear()
      }
    },
    // A stream that lost a hedged race is closed.
    (output) => {
      if (output.type === "stream") void output.chunks.return(undefined)
    }
  )
  const { model } = failover
  let value = failover.value
  if (cache?.write) {
    if (value.type === "json") {
      writeCache(cache, key, model.id, value.completion)
    } else {
      value = {
        type: "stream",
        chunks: collectStream(value.chunks, (completion) =>
          writeCache(cache, key, model.id, completion)
        ),
      }
    }
  }
  return { ...value, model }
}

/** Tracks usage and output while passing chunks through; finishes the recorder at the end. */
export async function* observeChat(
  chunks: AsyncIterable<ChatChunk>,
  recorder: RequestRecorder,
  request: ChatRequest
): AsyncGenerator<ChatChunk> {
  let usage: Usage | undefined
  let outputChars = 0
  let completed = false
  let failure: unknown
  const collected = {
    content: "",
    reasoning_content: "",
    tool_calls: [] as { name?: string; arguments: string }[],
  }

  try {
    for await (const chunk of chunks) {
      if (chunk.usage) usage = usageFromChat(chunk.usage) ?? usage
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {}
        if (typeof delta.content === "string") {
          outputChars += delta.content.length
          if (recorder.logPayloads) collected.content += delta.content
        }
        if (typeof delta.reasoning_content === "string") {
          outputChars += delta.reasoning_content.length
          if (recorder.logPayloads)
            collected.reasoning_content += delta.reasoning_content
        }
        for (const call of delta.tool_calls ?? []) {
          const args = call.function?.arguments ?? ""
          outputChars += args.length + (call.function?.name?.length ?? 0)
          if (recorder.logPayloads) {
            const entry = (collected.tool_calls[call.index] ??= {
              arguments: "",
            })
            if (call.function?.name) entry.name = call.function.name
            entry.arguments += args
          }
        }
      }
      yield chunk
    }
    completed = true
  } catch (error) {
    failure = error
    throw error
  } finally {
    recorder.usage = usage ?? {
      inputTokens: estimateRequestTokens(request),
      outputTokens: Math.ceil(outputChars / 4),
      cachedTokens: 0,
      reasoningTokens: 0,
      estimated: true,
    }
    if (recorder.logPayloads) recorder.responseBody = collected
    if (failure)
      recorder.fail(502, `Stream failed: ${toUpstreamError(failure).message}`)
    else if (!completed) recorder.fail(499, "Client closed the stream")
    else recorder.finish()
  }
}

export function finishJson(
  recorder: RequestRecorder,
  completion: ChatCompletion,
  request: ChatRequest
) {
  const text = completion.choices
    .map(
      (choice) =>
        `${choice.message?.content ?? ""}${choice.message?.reasoning_content ?? ""}${JSON.stringify(choice.message?.tool_calls ?? "")}`
    )
    .join("")
  recorder.usage = usageFromChat(completion.usage) ?? {
    inputTokens: estimateRequestTokens(request),
    outputTokens: estimateTokens(text),
    cachedTokens: 0,
    reasoningTokens: 0,
    estimated: true,
  }
  if (recorder.logPayloads) recorder.responseBody = completion
  recorder.finish()
}

export async function executeEmbeddings(options: {
  request: EmbeddingsRequest
  app: GatewayApp | null
  policy?: AccessPolicy
  /** Whose private providers may be used (default: the app's owner). */
  privateOwner?: string | null
  signal: AbortSignal
  recorder: RequestRecorder
}): Promise<{ response: EmbeddingsResponse; model: ModelRuntime }> {
  const { recorder } = options
  const request = protectEmbeddings(options.app, options.request, recorder)
  recorder.requestedModel = request.model || undefined
  const snapshot = await getSnapshot()
  const resolution = resolveModel(
    snapshot,
    request.model,
    "embedding" satisfies ModelKind,
    options.app,
    undefined,
    options.policy,
    options.privateOwner === undefined
      ? (options.app?.owner_email ?? null)
      : options.privateOwner
  )
  recorder.requestedModel = resolution.requestedModel
  recorder.route = resolution.route

  const { value, model } = await withFailover(
    snapshot,
    resolution,
    recorder,
    options.signal,
    async (candidate, ctx) => {
      const response = await adapterFor(candidate.provider.type).embeddings(
        { ...request, model: candidate.model_id },
        { model: candidate, signal: ctx.signal }
      )
      const problem = embeddingsProblem(
        response,
        embeddingInputCount(request.input),
        request.dimensions
      )
      if (problem) throw new UpstreamError(problem, null, { kind: "mismatch" })
      return response
    }
  )
  const reported = reportedEmbeddingTokens(value, request.input)
  const inputTokens = reported ?? estimateEmbeddingTokens(request.input)
  recorder.usage = {
    inputTokens,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    estimated: reported == null,
  }
  recorder.finish()
  return { response: normalizeEmbeddings(value, inputTokens), model }
}

/**
 * Images, speech, transcription and rerank: the request body is passed to
 * the provider as-is (with its model id), with the same routing, failover
 * and limits as chat. Resolves with the provider's response, body unread.
 */
export async function executeMedia(options: {
  kind: MediaKind
  path: MediaPath
  model: string
  app: GatewayApp | null
  policy?: AccessPolicy
  /** Whose private providers may be used (default: the app's owner). */
  privateOwner?: string | null
  /** The body for one attempt, given the provider's model id. */
  body: (modelId: string) => string | FormData
  signal: AbortSignal
  recorder: RequestRecorder
}): Promise<{ response: Response; model: ModelRuntime }> {
  const { recorder } = options
  recorder.requestedModel = options.model || undefined
  const snapshot = await getSnapshot()
  const resolution = resolveModel(
    snapshot,
    options.model,
    options.kind,
    options.app,
    undefined,
    options.policy,
    options.privateOwner === undefined
      ? (options.app?.owner_email ?? null)
      : options.privateOwner
  )
  recorder.requestedModel = resolution.requestedModel
  recorder.route = resolution.route

  const { value, model } = await withFailover(
    snapshot,
    resolution,
    recorder,
    options.signal,
    (candidate, ctx) => {
      const adapter = adapterFor(candidate.provider.type)
      if (!adapter.media) {
        throw new UpstreamError(
          `${candidate.provider.name} doesn't offer /${options.path}`,
          null,
          { kind: "config" }
        )
      }
      return adapter.media(options.path, options.body(candidate.model_id), {
        model: candidate,
        signal: ctx.signal,
      })
    },
    // A response that lost a hedged race is discarded unread.
    (response) => void response.body?.cancel().catch(() => {})
  )
  return { response: value, model }
}
