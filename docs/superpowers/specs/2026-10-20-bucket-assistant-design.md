# Bucket assistant: design

Date: 2026-10-20. Status: approved in chat, awaiting spec review.

## Goal

On an app's Models tab, a small chat lets the user describe the bucket they
want ("make me a bucket for embeddings"). The assistant looks at the models
the app's owner can use, asks how to tailor the bucket (free or paid, cheap
or best, how many fallbacks), and proposes changes. The user reviews the
proposal and clicks **Apply**; only then does the board change.

The assistant can create, delete, update (rename, order strategy, hedging,
model order, default) buckets, and add or remove models in them.

## Decisions

| Question | Decision |
|---|---|
| Which LLM runs the assistant, who pays | The app's own models. Calls are billed, limited and logged as this app. |
| How the model is chosen | A **Runs on** picker in the chat: this app's buckets plus the tool-capable chat models the owner may use. Remembered per app in `localStorage`. |
| When changes happen | The assistant only **proposes**; the user clicks **Apply**. |
| Architecture | The server runs the agent loop; the browser applies the proposal through the board's existing state and auto-save. |
| Streaming | Not in this version. The chat shows a "Thinking…" indicator per turn. |
| Chat history | In memory while the page is open; gone on reload. |

## Non-goals

- Streaming replies, saved chat history, markdown rendering.
- Toggling "Only allow models in these buckets" (the user did not ask for it).
- Any change outside the current app (routes, providers, other apps).
- A gateway-wide "system" model or new settings.
- New database tables or migrations.

## User experience

- **Entry:** an **Ask assistant** button (sparkles icon) in the Buckets card
  header, beside **New bucket**. It opens a right-side Animate UI `Sheet`
  (full width on phones). The board stays visible behind it.
- **Header:** title "Bucket assistant", the **Runs on** `Select` (groups:
  "This app's buckets", then models grouped by provider, each tagged Free or
  with its price), and a **New chat** button.
- **Empty state:** starter suggestions that send themselves when clicked:
  "Make an embeddings bucket", "Free chat bucket with fallbacks",
  "Cheapest coding bucket", "Review my buckets".
- **Messages:** user and assistant text, plain (`whitespace-pre-wrap`, as in
  the Playground). The assistant's tool use shows as small muted lines
  ("Looked at 34 models", "Checked your buckets").
- **Questions:** when the assistant calls `ask_user`, its question shows with
  2–5 clickable answers. Clicking one sends it as the user's next message;
  typing still works.
- **Proposal card:** one per chat at a time. Lists each change in plain words,
  with model names in try order, and **Discard** / **Apply** buttons. After
  Apply it shows "Applied", listing any step that was skipped and why. After
  Discard it shows "Discarded".
- **Footer:** a `Textarea` (Enter sends, Shift+Enter adds a new line, disabled
  while a turn runs) and the note "Runs on your models; billed to this app."
- **Errors:** an error bubble with **Retry** (re-sends the last message).

Components come from Animate UI first, shadcn otherwise; no hand-rolled
primitives.

## Architecture

```
AssistantPanel (client)                    askBucketAssistant (server action)
  messages, pending proposal, runsOn  ──▶    requireAppAccess, zod-validate input
  board snapshot from ModelsSection          loadBucketsData(app)  ─ models, addable
                                             runAssistantTurn(...)
                                               loop ≤ 8 × executeChat(tools)
                                               read tools ─ from BucketsData
                                               change tools ─ applyOp on a draft
  ◀── { reply, question?, steps, proposal, error? }
  Apply ─▶ ModelsSection.applyAssistantOps(ops) ─▶ board state ─▶ auto-save
                                              ─▶ saveAppBuckets (checks + audit)
```

### Files

| File | Role |
|---|---|
| `lib/bucket-assistant/ops.ts` | Pure, client-safe. `BucketsState`, `AssistantOp` types, `applyOp`, `describeOp`. Shared by server and browser. |
| `lib/bucket-assistant/tools.ts` | Server. Tool JSON schemas, zod argument schemas, executors over a `Workspace`. |
| `lib/bucket-assistant/prompt.ts` | Server. System prompt builder. |
| `lib/bucket-assistant/run.ts` | Server. `runAssistantTurn`: the loop, with the model call injected so tests can fake it. |
| `app/(dashboard)/apps/[id]/load-buckets-data.ts` | Server. Loading and building `BucketsData`, moved out of `page.tsx` so the page and the assistant share it. |
| `app/(dashboard)/apps/[id]/assistant-actions.ts` | `"use server"`. `getAssistantOptions(appId)` (picker contents) and `askBucketAssistant(appId, input)`. |
| `app/(dashboard)/apps/[id]/assistant-panel.tsx` | Client. The Sheet, messages, proposal card, picker. |
| `app/(dashboard)/apps/[id]/models-section.tsx` | Gains `applyAssistantOps(ops)` and passes the board snapshot and that callback to the panel. |
| `app/(dashboard)/apps/[id]/buckets-board.tsx` | Gains the **Ask assistant** button. |
| `lib/gateway/run-as-app.ts` | Server. `runChatAsApp`: one non-streamed chat request run as an app (see "Running a model call"). |
| `app/(dashboard)/apps/_access.ts` | Server. `requireAppAccess`, moved out of `apps/actions.ts` (see below). |

`requireAppAccess` in `apps/actions.ts` is module-private today. It moves to
`app/(dashboard)/apps/_access.ts` so both action files use the same check.

## Shared state and operations (`ops.ts`)

```ts
interface BucketsState {          // same shape as AppBucketsInput, names not keys
  buckets: { name: string; modelIds: string[]; strategy: BucketStrategy;
             hedgeAfterMs: number | null }[]
  defaultBucket: string | null
  onlyBucketModels: boolean
}

type AssistantOp =
  | { type: "create_bucket"; name: string; modelIds: string[];
      strategy?: BucketStrategy; hedgeAfterMs?: number | null; makeDefault?: boolean }
  | { type: "delete_bucket"; name: string }
  | { type: "add_models"; bucket: string; modelIds: string[]; position?: number }
  | { type: "remove_models"; bucket: string; modelIds: string[] }
  | { type: "update_bucket"; bucket: string; newName?: string;
      strategy?: BucketStrategy; hedgeAfterMs?: number | null;
      modelOrder?: string[]; makeDefault?: boolean }

applyOp(state, op, ctx: { addable: Set<string> })
  -> { ok: true; state: BucketsState; warnings: string[] } | { ok: false; error: string }
describeOp(op, modelName: (id) => string) -> string   // "Create bucket embed: 1. A, 2. B"
```

`applyOp` rules, matching `saveAppBuckets`:

- Names go through `toBucketName`, then must match `BUCKET_NAME_PATTERN`, not
  be `default`, and be unique.
- At most `MAX_BUCKETS` (20) buckets and `MAX_BUCKET_MODELS` (25) models per
  bucket. Duplicate models within a bucket are dropped.
- New model ids must be in `addable`. Ids already in a bucket stay, even if
  they're no longer addable, as on the board today.
- `hedgeAfterMs` is null or 250–60000.
- `modelOrder` must be a permutation of the bucket's current models.
- Deleting the default bucket clears `defaultBucket`. Renaming it keeps it
  the default.
- Not an error: mixing chat and embedding models in one bucket returns a
  warning, which the assistant is told to heed.

`ModelsSection` converts its keyed `Board` to `BucketsState` (the existing
`toInput`) and back, regenerating item keys for changed buckets.

## The assistant turn

### Input (`askBucketAssistant`)

```ts
{
  runsOn: string                     // bucket name or model slug
  messages: { role: "user" | "assistant"; content: string }[]   // ≤ 20, each ≤ 4000 chars
  board: BucketsState                // what the user sees now
  pendingOps: AssistantOp[]          // unapplied proposal, ≤ 50
}
```

Validated with zod. Only plain text is sent back and forth. Raw tool calls
and results never round-trip through the browser, so the model only ever
sees tool results the server produced. The server rebuilds context each
turn.

### Output

```ts
{
  ok: true
  reply: string                      // assistant text (may be empty if it only asked)
  question?: { text: string; options: string[] }
  steps: string[]                    // "Looked at 34 models", …
  proposal: { ops: AssistantOp[]; lines: string[]; warnings: string[] }   // ops empty = no proposal
  usage: { calls: number; inputTokens: number; outputTokens: number; costUsd?: number }
} | { ok: false; error: string }
```

### Loop (`runAssistantTurn`)

1. Load `BucketsData` for the app (models, addable, health, usage).
2. Start the draft: `board`, then `pendingOps` replayed with `applyOp`. Ops
   that no longer apply are dropped, and a note goes into the system prompt.
3. Build messages: the system prompt, then the user/assistant history.
4. Repeat, up to **8 model calls**:
   - Call the model with the tools, `tool_choice: "auto"`, temperature 0.2,
     not streamed.
   - No tool calls: the turn ends, and its text is `reply`.
   - Otherwise, run each tool call in order and append the assistant
     message and the tool results.
   - `ask_user` ends the turn after the current batch of calls, and its
     question is returned.
   - 3 failed tool calls in a row (bad arguments or a rule broken) end the
     turn with a short apology note.
5. Hitting the 8-call cap returns what exists so far, plus a note that the
   assistant stopped early.
6. The proposal returned is `pendingOps` plus every change op that succeeded
   this turn, with `describeOp` lines and the warnings.

The whole turn has a 120 s timeout (`AbortSignal.timeout`).
`app/(dashboard)/apps/[id]/page.tsx` exports `maxDuration = 300` (as the
Playground page does) so the server action isn't cut off sooner.

### Tools

Models are referred to by **slug** (unique in `models`). The server maps
slugs to ids and reports unknown slugs as tool errors.

| Tool | Arguments | Result |
|---|---|---|
| `list_models` | `kind?` (chat, embedding, or another `ModelKind`), `price?` (free/paid/any), `capabilities?` (Capability[]), `query?` (matches name, slug, provider) | Addable models only, sorted by price (free first, then input+output price ascending), each with: slug, name, provider, kind, price per Mtok in/out (or "unknown"), context window, capabilities, health (ok, cooling, unavailable plus label), this month's requests. At most 60 rows, plus `{ total, truncated }`. |
| `list_buckets` | — | The draft: each bucket with name, strategy, hedge, default flag, and models (slug, name, kind, price tier, health) in try order; plus `onlyBucketModels`. |
| `create_bucket` | `name`, `models` (slugs, try order), `strategy?`, `hedge_after_ms?`, `make_default?` | `applyOp` on the draft: ok plus warnings, or an error. |
| `delete_bucket` | `name` | Same. |
| `add_models` | `bucket`, `models`, `position?` (1-based) | Same. |
| `remove_models` | `bucket`, `models` | Same. |
| `update_bucket` | `bucket`, `new_name?`, `strategy?`, `hedge_after_ms?`, `model_order?`, `make_default?` | Same. |
| `ask_user` | `question`, `options` (2–5 short strings) | Ends the turn. |

Each step line comes from its tool: "Looked at N models", "Checked your
buckets", or a `describeOp` line for change tools.

### System prompt (outline)

- You are the bucket assistant for app "<name>". A bucket is a named list of
  models tried in order; explain nothing the user didn't ask about.
- You only propose. The user applies with a button. Never claim a change is
  live.
- Before proposing, make sure you know: what the bucket is for (chat,
  embeddings, coding…), the price preference (free only, cheap, best
  quality), and roughly how many fallbacks (default 2–4). Ask with
  `ask_user` when one of these isn't clear; ask at most two questions in a row.
- Use only models returned by `list_models`. Never invent slugs.
- Pick models of the right kind. Prefer healthy ones. Mix providers so one
  outage doesn't take out the whole chain. Put the best fit first.
- Suggest short, lowercase bucket names the user's code will call.
- End with one or two sentences summarising the proposal.
- Context lines: today's buckets (names only), the owner's access (e.g.
  "free models only"), and notes about dropped pending ops.

## Running a model call

The assistant runs each call like the Playground does:

- Context: `loadAppContext(appId)`. Check the app is enabled, then
  `enforceLimits(context)` before each model call.
- Recorder: `new RequestRecorder("bucket-assistant")`, logged under the app
  with the owner's email, then `finishJson` and `persist`.
- Call: `executeChat` with `app: { ...context.app, only_bucket_models: false }`
  so the picker's model isn't blocked by that rule. `policy` is the owner's
  policy. `privateOwner` is the owner only when the person chatting owns the
  app (`privateOwnerFor`).

This becomes `runChatAsApp({ request, context, runnerEmail, endpoint, signal })`
in `lib/gateway/run-as-app.ts`. It returns the completion, the serving model,
usage and cost, or throws `GatewayError`. `runPlayground` can adopt it later, but that
refactor isn't required here.

## Runs on picker (`getAssistantOptions`)

- Uses the same access check as `askBucketAssistant`.
- Returns this app's buckets whose models include at least one chat model,
  and the chat models the owner may use (the `addable` rule) that have the
  `tools` capability, grouped by provider, with a price tier.
- If no model has the `tools` capability, the picker shows all chat models
  with a note that the assistant needs tool calling.

`askBucketAssistant` re-checks that `runsOn` is in that set before running.

## Errors and limits

| Case | Behaviour |
|---|---|
| Not the owner or an admin | `{ ok: false, error: "Unknown app" }`, as `requireAppAccess` does today. |
| `runsOn` not allowed | "Pick a model from the list". |
| Limits or budget exceeded | The `GatewayError` message, shown in an error bubble. |
| Model or provider failure | The `GatewayError` message, with Retry. |
| Model returned tool calls badly, or doesn't support tools | Error: "<model> couldn't use the assistant's tools. Try another model in Runs on." |
| Input too large | zod error message. |
| Apply step no longer fits | Skipped. The card lists it with the `applyOp` error; the other steps still apply. |
| Save after Apply fails | The board's existing "Not saved. Retry" indicator. |

## Security

- Same access as editing buckets: the app's owner or an admin, through
  `requireAppAccess`. Dashboard sessions already require 2FA (aal2).
- The assistant writes nothing. Changes reach the database only when the
  user clicks Apply, through `saveAppBuckets`, which re-checks every model
  against the owner's policy and writes the audit entry.
- Tool results are produced on the server from the database. The browser
  only sends plain text, its board snapshot, and pending ops, all
  re-validated, and those only shape a proposal the user still has to apply.
- Model and provider names in tool results are data. A name crafted to steer
  the assistant could at worst produce a bad proposal, which the user sees
  before applying.
- Spend goes through the app's existing limits and budgets. Per-turn caps:
  8 calls, 20 messages, 4000 characters per message, 120 s.

## Testing

`bun test` unit tests in `tests/`:

- `bucket-assistant-ops.test.ts`: every op type; each rule (name format,
  reserved name, duplicates, bucket and model limits, non-addable model,
  missing bucket, bad `modelOrder`, hedge range); default handling on delete
  and rename; the mixed-kind warning; `describeOp` wording.
- `bucket-assistant-tools.test.ts`: `list_models` filters, sort order, the
  60-row cut-off and `truncated`; unknown slugs; `list_buckets` reflects the
  draft.
- `bucket-assistant-run.test.ts`, with a scripted fake model call:
  - Plain reply.
  - Tool call, then reply.
  - `ask_user` stops the turn and returns the question.
  - The 8-call cap.
  - 3 failed tool calls in a row stop the turn.
  - `pendingOps` are replayed, and a stale one is dropped with a note.
  - The proposal accumulates across turns.

UI: render the panel and board with fake data on a temporary route,
screenshot it with headless Chrome, then delete the route. End to end: the
user runs one real chat on a free tool-capable model in local dev, since
sign-in needs their 2FA.
