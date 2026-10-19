# Bucket Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loud mixed-kind warnings on every bucket, then a chat assistant on an app's Models tab that proposes bucket changes the user applies with one click.

**Architecture:** Pure, client-safe modules hold the rules: `lib/bucket-kinds.ts` for the mixed-kind checks and wording, and `lib/bucket-assistant/ops.ts` with `applyOp`. A server action runs the agent loop (`runAssistantTurn`) over the gateway's own pipeline (`runChatAsApp` → `executeChat`), as the app being edited. Read tools query `BucketsData`; change tools only build a proposal. The browser applies the proposal through the board's state and existing auto-save, so `saveAppBuckets` stays the only writer.

**Tech Stack:** Next.js 16.3.6 (server actions), React 19, TypeScript, zod, Supabase, bun test, Animate UI (Radix) + shadcn components, sonner.

**Spec:** `docs/superpowers/specs/2026-10-20-bucket-assistant-design.md`

## Global Constraints

- This Next.js has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing server actions, route segment config or other Next-specific code.
- UI comes from installed registry components: Animate UI first (`@/components/animate-ui/components/buttons/button`, `.../radix/sheet`, `.../radix/tooltip`, `.../radix/popover`), shadcn otherwise (`@/components/ui/alert`, `badge`, `select`, `textarea`, `scroll-area`). No hand-rolled primitives.
- Format only the files you touched: `npx prettier --write <file>`. Never run it on a directory. Never format vendored registry files (`components/ui/kanban.tsx`, `components/animate-ui/**`).
- Commit on `main` locally. No `Co-Authored-By` or "Generated with" lines. Don't push unless the user asks.
- Tests: `npm test` (`bun test --conditions react-server tests`). `server-only` modules import fine under that condition.
- Spec limits, verbatim:
  - 8 model calls per message.
  - 3 failed tool calls in a row.
  - 20 messages, 4000 characters each.
  - 50 pending ops.
  - 60 `list_models` rows.
  - 120 s per turn; `maxDuration = 300`.
  - Recorder endpoint `"bucket-assistant"`.
  - Temperature 0.2, `tool_choice: "auto"`.
- Bucket rules come from `app/(dashboard)/apps/_lib.ts`: `BUCKET_NAME_PATTERN`, `MAX_BUCKETS` (20), `MAX_BUCKET_MODELS` (25), `toBucketName`. The name `default` is reserved. Hedge is null or 250–60000 ms.
- UI copy is plain sentences, no markdown.

## Review Focus

1. **Malformed tool arguments** (the model sends invalid JSON in `function.arguments`): the tool returns an error the model can read, and the workspace is unchanged. Test in Task 7.
2. **One model message holding a change tool and `ask_user` together:** both run, the turn ends with the question, and the proposal keeps the change. Test in Task 8.
3. **Human-style bucket names** ("My Embeddings!"): normalized by `toBucketName`, and the normalized name is what's stored, described and applied. Test in Task 3.
4. **The board edited by hand between proposal and Apply** (target bucket deleted): that step is skipped with its reason, and the rest still apply. Test in Task 3.
5. **A remembered Runs on choice that's no longer offered** (bucket deleted, model disabled): the server rejects it, and the panel falls back to the first option. Test in Task 6.

---

### Task 1: Mixed-kind helper

**Files:**
- Create: `lib/bucket-kinds.ts`
- Test: `tests/bucket-kinds.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface KindedModel { id: string; name: string; kind: ModelKind }
  interface KindMix { primary: ModelKind; counts: Partial<Record<ModelKind, number>>; offKind: KindedModel[] }
  bucketKindMix(models: KindedModel[]): KindMix | null
  mixWarningText(bucketName: string, mix: KindMix): { title: string; body: string }
  offKindToast(modelName: string, modelKind: ModelKind, bucketName: string, primary: ModelKind): string
  kindModelLabel(kind: ModelKind): string   // "Embedding model"
  ```
  Kind words are `MODEL_KIND_LABELS[kind].toLowerCase()` (`@/lib/model-kinds`). Use "an" before a vowel, "a" otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test"
import type { ModelKind } from "@/lib/db/types"
import { bucketKindMix, kindModelLabel, mixWarningText, offKindToast } from "@/lib/bucket-kinds"

const m = (id: string, kind: ModelKind) => ({ id, name: `Model ${id}`, kind })

describe("bucketKindMix", () => {
  test("one kind or empty is not a mix", () => {
    expect(bucketKindMix([])).toBeNull()
    expect(bucketKindMix([m("a", "chat"), m("b", "chat")])).toBeNull()
  })
  test("primary is the first model's kind", () => {
    const mix = bucketKindMix([m("e", "embedding"), m("c1", "chat"), m("c2", "chat")])!
    expect(mix.primary).toBe("embedding")
    expect(mix.counts).toEqual({ embedding: 1, chat: 2 })
    expect(mix.offKind.map((x) => x.id)).toEqual(["c1", "c2"])
  })
})

describe("mixWarningText", () => {
  test("two kinds, plural", () => {
    const mix = bucketKindMix([m("c1", "chat"), m("c2", "chat"), m("c3", "chat"), m("e1", "embedding"), m("e2", "embedding")])!
    expect(mixWarningText("smart", mix)).toEqual({
      title: "This bucket mixes chat and embedding models",
      body: "Chat requests to smart only try its 3 chat models. The 2 embedding models are skipped, never used as fallbacks, so if the chat models fail the request fails. Embedding requests do the reverse. Move them into their own bucket.",
    })
  })
  test("two kinds, singular", () => {
    const mix = bucketKindMix([m("c1", "chat"), m("e1", "embedding")])!
    expect(mixWarningText("smart", mix).body).toBe(
      "Chat requests to smart only try its 1 chat model. The 1 embedding model is skipped, never used as fallbacks, so if the chat model fails the request fails. Embedding requests do the reverse. Move it into its own bucket."
    )
  })
  test("three kinds", () => {
    const mix = bucketKindMix([m("c1", "chat"), m("c2", "chat"), m("e1", "embedding"), m("e2", "embedding"), m("i1", "image")])!
    expect(mixWarningText("mixed", mix)).toEqual({
      title: "This bucket mixes chat, embedding and image models",
      body: "Chat requests to mixed only try its 2 chat models. The other 3 models (2 embedding, 1 image) are skipped, never used as fallbacks, so if the chat models fail the request fails. Other requests only use models of their own kind. Move them into their own buckets.",
    })
  })
})

test("offKindToast and kindModelLabel", () => {
  expect(offKindToast("Gemini Embedding 2", "embedding", "smart", "chat")).toBe(
    "Gemini Embedding 2 is an embedding model. Chat requests to smart will skip it."
  )
  expect(offKindToast("GPT Image", "image", "embed", "embedding")).toBe(
    "GPT Image is an image model. Embedding requests to embed will skip it."
  )
  expect(kindModelLabel("embedding")).toBe("Embedding model")
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/bucket-kinds.test.ts`
Expected: FAIL, cannot find module `@/lib/bucket-kinds`.

- [ ] **Step 3: Implement `lib/bucket-kinds.ts`**

Pure, with no server imports. Count kinds in order of first appearance, so the title lists them in bucket order.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/bucket-kinds.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/bucket-kinds.ts tests/bucket-kinds.test.ts
git add lib/bucket-kinds.ts tests/bucket-kinds.test.ts
git commit -m "Buckets: helper that spots and words mixed model kinds"
```

### Task 2: Mixed-kind warnings on the board

**Files:**
- Modify: `app/(dashboard)/apps/[id]/buckets-board.tsx` (`BucketColumn`, `ModelCardBody`, `AddModelPopover`)
- Modify: `app/(dashboard)/apps/[id]/models-section.tsx` (`addModel`)
- Temporary (deleted in this task): `app/auth/zz-preview-buckets/page.tsx`

**Interfaces:**
- Consumes: Task 1's `bucketKindMix`, `mixWarningText`, `offKindToast`, `kindModelLabel`.
- Produces:
  - `ModelCardBody` gains the optional prop `skippedFor?: ModelKind`, set when the card's kind differs from the bucket's primary kind.
  - `AddModelPopover` gains `primaryKind: ModelKind | null`.

- [ ] **Step 1: Lane banner and header badge.** In `BucketColumn`, compute `mix = bucketKindMix(items with a known model → { id, name, kind })`.
  - Header: when `mix` is set, put `<Badge variant="destructive">Mixed kinds</Badge>` after the name, next to Default.
  - Banner: between the header and the strategy help line, put `<Alert variant="destructive">` with `TriangleAlertIcon`, `AlertTitle` = `title` and `AlertDescription` = `body` from `mixWarningText(name, mix)`.

- [ ] **Step 2: Off-kind cards.** Pass `skippedFor={mix?.primary}` only to cards whose model kind ≠ `mix.primary`. Such a card gets `border-dashed border-destructive` and a `Badge variant="destructive"` reading `kindModelLabel(model.kind)`. The badge sits in a `Tooltip` whose content is `` `Skipped for ${primary} requests to this bucket` ``, where `primary` is the lowercase kind word.

- [ ] **Step 3: Add model popover.** Pass `primaryKind` (the first known model's kind, or null). Options whose kind ≠ `primaryKind` show a `Badge variant="destructive"` with `kindModelLabel(kind)` before the price.

- [ ] **Step 4: Toast on manual add.** In `ModelsSection.addModel`, take the primary kind from the bucket's first item. If it exists and the added model's kind differs, call `toast.warning(offKindToast(name, kind, bucketName, primary))` instead of `toast.success`. Drag-and-drop, the popover and the library's Add all go through `addModel`.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p . && npx eslint "app/(dashboard)/apps/[id]/buckets-board.tsx" "app/(dashboard)/apps/[id]/models-section.tsx"`
Expected: no output, exit 0.

- [ ] **Step 6: Visual check.**
  1. Create the temporary preview route `app/auth/zz-preview-buckets/page.tsx`. It's a client page that renders `BucketsBoard` with fake `BucketModel`s and a no-op save, inside `div.grid.min-w-0` wrappers that match the dashboard nesting. `/auth/` is public in `proxy.ts`. Include:
     - a bucket "smart" holding 3 chat and 2 embedding models;
     - a pure chat bucket.
  2. Start `npx next dev -p 3300 -H 127.0.0.1`.
  3. Screenshot it with headless Chrome (`--headless=new --user-data-dir=<scratchpad profile> --window-size=1400,1300 --virtual-time-budget=8000 --screenshot`). Repeat at width 500.

  Expected:
  - The red banner with the exact Task 1 wording appears only on "smart".
  - "Mixed kinds" appears next to its name.
  - The 2 embedding cards have red dashed borders and an "Embedding model" badge.
  - The chat bucket shows nothing new.

- [ ] **Step 7: Remove the preview.** Stop the dev server, `rm -r app/auth/zz-preview-buckets`, `rm -rf .next/dev/types`, then run `npx tsc --noEmit -p .`. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
npx prettier --write "app/(dashboard)/apps/[id]/buckets-board.tsx" "app/(dashboard)/apps/[id]/models-section.tsx"
git add "app/(dashboard)/apps/[id]/buckets-board.tsx" "app/(dashboard)/apps/[id]/models-section.tsx"
git commit -m "Buckets: warn loudly when a bucket mixes model kinds"
```

### Task 3: Bucket operations (shared rules)

**Files:**
- Create: `lib/bucket-assistant/ops.ts`
- Create: `tests/bucket-fixtures.ts`
- Test: `tests/bucket-assistant-ops.test.ts`

**Interfaces:**
- Consumes: Task 1's `bucketKindMix`, `mixWarningText`; `_lib.ts` constants; `STRATEGY_OPTIONS`, `HEDGE_OPTIONS` and `BucketModel`/`BucketsData` types from `app/(dashboard)/apps/[id]/buckets-shared.ts`.
- Produces (all pure, client-safe):
  ```ts
  interface StateBucket { name: string; modelIds: string[]; strategy: BucketStrategy; hedgeAfterMs: number | null }
  interface BucketsState { buckets: StateBucket[]; defaultBucket: string | null; onlyBucketModels: boolean }
  type AssistantOp = /* the five variants in the spec, camelCase fields */
  interface KindWarning { bucket: string; title: string; body: string }
  interface OpContext { addable: ReadonlySet<string>; models: ReadonlyMap<string, { id: string; name: string; kind: ModelKind }> }
  type OpResult = { ok: true; state: BucketsState; op: AssistantOp /* normalized names */; warnings: KindWarning[] } | { ok: false; error: string }
  applyOp(state: BucketsState, op: AssistantOp, ctx: OpContext): OpResult
  applyOps(state: BucketsState, ops: AssistantOp[], ctx: OpContext):
    { state: BucketsState; applied: AssistantOp[]; skipped: { op: AssistantOp; error: string }[] }
  proposalWarnings(state: BucketsState, ops: AssistantOp[], ctx: OpContext): KindWarning[]  // mixed buckets among those the ops touch (final names)
  describeOp(op: AssistantOp, nameOf: (id: string) => string): string
  opContext(models: { id: string; name: string; kind: ModelKind }[], addable: Iterable<string>): OpContext
  ```
- `tests/bucket-fixtures.ts` produces:
  - `bucketModel(overrides: Partial<BucketModel> & { id: string }): BucketModel`, with defaults: chat, ok status, tools capability, $0 prices, provider "Prov".
  - `bucketsData(models: BucketModel[], extra?: Partial<BucketsData>): BucketsData`, where every model is addable.

Rules, in addition to the spec's `applyOp` list:
- `create_bucket` defaults: `strategy` "ordered", `hedgeAfterMs` null. If there's no default bucket, the new one becomes the default (as the board does). `makeDefault: true` sets it.
- `update_bucket` with `makeDefault: false` clears the default only if it's this bucket.
- `add_models.position` is 1-based. Models already in the bucket are ignored.
- `remove_models` of a model not in the bucket is an error.

`describeOp` copy, exact:
- `Create bucket "embed": 1. A, 2. B`, or `Create bucket "x" (empty)`. With `makeDefault`, append ` · make it the default`.
- `Delete bucket "old"`
- `Add A, B to "smart"`, with ` at position 1` when a position is given.
- `Remove A from "smart"`
- `Update "smart": ` followed by parts joined with `, `, in this order:
  - `rename to "fast"`
  - `order: Cheapest first` (the `STRATEGY_OPTIONS` label)
  - `hedge after 2 s`, or `no hedging`
  - `models in order 1. A, 2. B`
  - `make it the default`, or `stop being the default`

Errors name the thing (bucket name, model name, limit), e.g. `There's no bucket named "fast"` and `"default" is reserved`.

- [ ] **Step 1: Write the fixtures and failing tests.** Cover each case below with concrete values:
  - **Create:** defaults; auto-default on the first bucket; `makeDefault`.
  - **Name normalization (Review Focus 3):** `create_bucket` named `"My Embeddings!"` stores `toBucketName("My Embeddings!")`. The result's `op.name` and `describeOp(result.op, …)` use the normalized name.
  - **Name errors:** `default` (contains "reserved"); a duplicate (contains "already"); `"---"` (invalid); the 21st bucket; 26 models; a non-addable model (error contains the model's name).
  - **Add:** append; insert at `position: 1`; a duplicate is ignored; going over 25 is an error.
  - **Remove:** removes the models; a missing model is an error.
  - **Update:** rename keeps the default; renaming to a taken name is an error; strategy; hedge 2000 ok, 100 is an error; a `modelOrder` permutation is ok, a missing id is an error; `makeDefault` true and false.
  - **Delete:** clears the default; an unknown bucket is an error naming it.
  - **Existing models:** a model that's no longer addable but already in a bucket survives `update_bucket` with `modelOrder`.
  - **Warnings:** creating a bucket with 1 chat and 1 embedding model gives one `KindWarning`, with `bucket` "x" and `title` "This bucket mixes chat and embedding models". `proposalWarnings` reports it for the touched bucket and ignores untouched mixed ones.
  - **Partial apply (Review Focus 4):** `applyOps(state without "fast", [add_models to "fast", create_bucket "embed"])` gives `applied.length === 1`, `skipped.length === 1`, and `skipped[0].error` contains `"fast"`.
  - **`describeOp`:** each copy string above, exactly.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/bucket-assistant-ops.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/bucket-assistant/ops.ts`.** Never mutate the input state. Return new objects.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/bucket-assistant-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/bucket-assistant/ops.ts tests/bucket-fixtures.ts tests/bucket-assistant-ops.test.ts
git add lib/bucket-assistant/ops.ts tests/bucket-fixtures.ts tests/bucket-assistant-ops.test.ts
git commit -m "Bucket assistant: shared bucket operations and their rules"
```

### Task 4: Board ↔ state conversion

**Files:**
- Create: `app/(dashboard)/apps/[id]/board-state.ts`
- Modify: `app/(dashboard)/apps/[id]/models-section.tsx` (move `BoardItem`, `Board`, `BucketSettings`, `SaveState`, `makeKey`, `initialBoard`, `toInput`, `duplicateIn` out; import them)
- Modify: `app/(dashboard)/apps/[id]/buckets-board.tsx` (type imports from `./board-state`)
- Test: `tests/board-state.test.ts`

**Interfaces:**
- Consumes: Task 3's `BucketsState`.
- Produces: the moved types and functions unchanged, plus:
  - `toInput(board: Board): BucketsState`, the same return value as today, now typed.
  - `stateToBoard(state: BucketsState, previous: Board): Board`. It reuses `previous` bucket keys for buckets with the same name, and item keys for the same (bucket name, modelId). Anything new gets a fresh `makeKey` key. `defaultKey` maps by name.

- [ ] **Step 1: Write the failing tests.**
  - `toInput(initialBoard(data))` deep-equals the `BucketsState` from `data`.
  - `stateToBoard(toInput(board), board)` keeps every bucket key and item key.
  - After adding a bucket, the old keys are kept and the new bucket's key is not one of them.
  - A deleted bucket disappears, and the default maps to the right key.

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- tests/board-state.test.ts`. Expected: FAIL.

- [ ] **Step 3: Move the code and implement `stateToBoard`.** `board-state.ts` has no React and no `"use client"`.

- [ ] **Step 4: Run all tests and the typecheck.** Run: `npm test && npx tsc --noEmit -p .`. Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "app/(dashboard)/apps/[id]/board-state.ts" "app/(dashboard)/apps/[id]/models-section.tsx" "app/(dashboard)/apps/[id]/buckets-board.tsx" tests/board-state.test.ts
git add "app/(dashboard)/apps/[id]/board-state.ts" "app/(dashboard)/apps/[id]/models-section.tsx" "app/(dashboard)/apps/[id]/buckets-board.tsx" tests/board-state.test.ts
git commit -m "Models tab: board state helpers in their own module"
```

### Task 5: Shared server pieces

**Files:**
- Create: `app/(dashboard)/apps/_access.ts` (`requireAppAccess`, `isDenied`, moved from `apps/actions.ts:60-90`)
- Modify: `app/(dashboard)/apps/actions.ts` (import them)
- Create: `app/(dashboard)/apps/[id]/load-buckets-data.ts` (`buildBucketsData`, `PageModel`, moved from `page.tsx`, plus `loadBucketsData`)
- Modify: `app/(dashboard)/apps/[id]/page.tsx` (use the loader; add `export const maxDuration = 300`)
- Create: `lib/gateway/run-as-app.ts`
- Modify: `lib/gateway/playground.ts` (export `privateOwnerFor`)

**Interfaces:**
- Produces:
  ```ts
  // _access.ts (server only, no "use server": it isn't an action)
  requireAppAccess(appId: string): Promise<SessionMember | { ok: false; error: string }>
  isDenied(value): value is { ok: false; error: string }
  // load-buckets-data.ts (server only)
  loadBucketsData(supabase: Awaited<ReturnType<typeof createClient>>,
    app: Pick<AppRow, "id" | "owner_email" | "default_model" | "only_bucket_models">):
    Promise<{ data: BucketsData; modelSlugs: Map<string, string> }>
  // run-as-app.ts (server only)
  runChatAsApp(options: { request: ChatRequest; context: AuthContext; runnerEmail: string;
    endpoint: string; signal: AbortSignal }):
    Promise<{ message: ChatMessage; modelSlug: string; inputTokens: number; outputTokens: number; costUsd?: number }>
  ```
- `loadBucketsData` runs in parallel the queries `page.tsx` makes today for this purpose:
  - models;
  - this month's usage by model;
  - `app_buckets`;
  - `model_health`;
  - providers (via `supabaseAdmin`);
  - the owner's `members` row;
  - `loadReach`.

  It then calls `buildBucketsData`. `modelSlugs` maps every model id to its slug, as `page.tsx` builds it today.
- `runChatAsApp` follows `runPlayground` (`lib/gateway/playground.ts:130-230`):
  1. If `!context.app.enabled`, throw the same `GatewayError(403, …, "app_disabled", "permission_error")`.
  2. Create `new RequestRecorder(endpoint)` and call `enableLogging({ appId, apiKeyId: null, ownerEmail: context.owner.email, logPayloads: context.app.log_payloads })`.
  3. Run `enforceLimits(context)`.
  4. Call `executeChat` with:
     - `request: { ...request, stream: false }`;
     - `app: { ...context.app, only_bucket_models: false }`;
     - `policy: context.owner.policy`;
     - `privateOwner: privateOwnerFor(context, runnerEmail)`.
  5. Require `type === "json"`, then call `finishJson`.
  6. On error, call `recorder.fail(status, message)` and rethrow. In `finally`, call `recorder.persist()`.
  7. `costUsd` is undefined when `priceTier(...)` is "unknown".

- [ ] **Step 1: Move `requireAppAccess`/`isDenied`, extract the loader, add `maxDuration`, add `runChatAsApp`.** The page's rendered output must be unchanged: the Usage tab still gets `modelSlugs`, and the Integrate snippets still read the bucket names from `data.buckets`.

- [ ] **Step 2: Verify there's no regression**

Run: `npm test && npx tsc --noEmit -p . && npx eslint "app/(dashboard)/apps" lib/gateway/run-as-app.ts lib/gateway/playground.ts`
Expected: all pass, no lint errors.

- [ ] **Step 3: Commit**

```bash
npx prettier --write "app/(dashboard)/apps/_access.ts" "app/(dashboard)/apps/actions.ts" "app/(dashboard)/apps/[id]/load-buckets-data.ts" "app/(dashboard)/apps/[id]/page.tsx" lib/gateway/run-as-app.ts lib/gateway/playground.ts
git add "app/(dashboard)/apps/_access.ts" "app/(dashboard)/apps/actions.ts" "app/(dashboard)/apps/[id]/load-buckets-data.ts" "app/(dashboard)/apps/[id]/page.tsx" lib/gateway/run-as-app.ts lib/gateway/playground.ts
git commit -m "Apps: share app access, bucket data loading and running chat as an app"
```

### Task 6: Turn contract and Runs on options

**Files:**
- Create: `lib/bucket-assistant/contract.ts`
- Create: `lib/bucket-assistant/options.ts`
- Test: `tests/bucket-assistant-options.test.ts`

**Interfaces:**
- Consumes: Task 3's types; `priceTier` from `@/lib/pricing`.
- Produces (client-safe):
  ```ts
  // contract.ts
  const MAX_HISTORY = 20, MAX_MESSAGE_CHARS = 4000, MAX_PENDING_OPS = 50
  assistantOpSchema, bucketsStateSchema, assistantTurnInputSchema   // zod
  type AssistantTurnInput = z.infer<typeof assistantTurnInputSchema>  // { runsOn, messages, board, pendingOps }
  interface AssistantProposal { ops: AssistantOp[]; lines: string[]; warnings: KindWarning[] }
  interface AssistantTurnResult { reply: string; question?: { text: string; options: string[] };
    steps: string[]; proposal: AssistantProposal;
    usage: { calls: number; inputTokens: number; outputTokens: number; costUsd?: number } }
  // options.ts
  interface AssistantOptions { buckets: { name: string }[];
    modelGroups: { provider: string; models: { slug: string; name: string; tier: PriceTier;
      inputPrice: number | null; outputPrice: number | null }[] }[];
    toolsKnown: boolean }
  buildAssistantOptions(data: BucketsData): AssistantOptions
  isAllowedRunsOn(options: AssistantOptions, runsOn: string): boolean
  ```
- `buildAssistantOptions` works as follows:
  - **Buckets:** those with at least one chat model, in board order.
  - **Models:** addable chat models with the `tools` capability, grouped by `provider`. Groups and models are sorted by name.
  - **No tool-capable models:** if none has `tools`, `toolsKnown` is false and every addable chat model is listed.

- [ ] **Step 1: Write the failing tests.**
  - The schema accepts a valid input and rejects 21 messages, a 4001-character message, and 51 pending ops.
  - Buckets: one holding only embedding models is excluded.
  - Models: non-addable and embedding models are excluded; grouping and sorting are as above; `toolsKnown` is false with no tool-capable chat models.
  - `isAllowedRunsOn` (Review Focus 5) is true for a listed bucket name and a listed slug, and false for a deleted bucket's name and a disabled model's slug.

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- tests/bucket-assistant-options.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement both files.**

- [ ] **Step 4: Run to verify it passes.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/bucket-assistant/contract.ts lib/bucket-assistant/options.ts tests/bucket-assistant-options.test.ts
git add lib/bucket-assistant/contract.ts lib/bucket-assistant/options.ts tests/bucket-assistant-options.test.ts
git commit -m "Bucket assistant: turn contract and the Runs on options"
```

### Task 7: Tools

**Files:**
- Create: `lib/bucket-assistant/tools.ts`
- Test: `tests/bucket-assistant-tools.test.ts`

**Interfaces:**
- Consumes: Task 3's `applyOp`, `describeOp`, `opContext`, `BucketsState`, `AssistantOp`, `KindWarning`; `ChatTool` from `@/lib/gateway/types`.
- Produces:
  ```ts
  interface Workspace { models: BucketModel[]; bySlug: Map<string, BucketModel>; ctx: OpContext;
    state: BucketsState; ops: AssistantOp[] }
  createWorkspace(data: BucketsData, state: BucketsState): Workspace
  const TOOLS: ChatTool[]   // list_models, list_buckets, create_bucket, delete_bucket,
                            // add_models, remove_models, update_bucket, ask_user
  const MAX_LIST_ROWS = 60
  interface ToolOutcome { ok: boolean; content: string /* JSON text for the model */; step: string;
    question?: { text: string; options: string[] }; warnings: KindWarning[] }
  runTool(ws: Workspace, name: string, rawArgs: string): ToolOutcome   // on success mutates ws.state, pushes the normalized op
  ```
- Tool arguments are snake_case, as in the spec table. Change tools take slugs, mapped to ids through `bySlug`. An unknown slug is an error naming it.
- Results:
  - Success: `{"ok":true,"warnings":["<title>. <body>"]}`.
  - Failure: `{"ok":false,"error":"…"}`.
  - List tools return `{ total, truncated, models: [...] }` and `{ buckets: [...], onlyBucketModels }`.
- `list_models` sort order: free first, then input+output price ascending, unknown prices last, ties broken by name.
- Steps: `` `Looked at ${total} models` ``, `Checked your buckets`, and the `describeOp` line for change tools. Failed calls get `Tried a change that didn't fit`.
- Every tool's description says what it does in one sentence. Change tools add: "This only adds to the proposal; the user applies it."

- [ ] **Step 1: Write the failing tests.**
  - `TOOLS` names, in order.
  - `list_models` filters on `kind`, `price` "free", `capabilities` and `query` (matches the provider), and only returns addable models.
  - Sort order as above.
  - With 70 models, 60 rows come back with `total` 70 and `truncated` true, and the step is `Looked at 70 models`.
  - `list_buckets` shows a bucket created earlier in the same workspace.
  - `create_bucket` with two slugs pushes one op with the right ids, and its step equals the `describeOp` line.
  - An unknown slug gives `ok` false with the slug in `content`, and `ws.ops` stays empty.
  - **Malformed JSON (Review Focus 1):** `runTool(ws, "create_bucket", "{not json")` gives `ok` false, `content` contains "arguments", and `ws.state` deep-equals its value before the call.
  - An unknown tool name gives `ok` false.
  - `ask_user` with 2 options returns a `question`. With 1 option it gives `ok` false.
  - Creating a mixed bucket gives `warnings.length === 1`, and `content` contains "This bucket mixes chat and embedding models".

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- tests/bucket-assistant-tools.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `tools.ts`.** JSON-parse the arguments in a try/catch, then use zod. Error text: `Those arguments aren't valid JSON` and `Bad arguments: <first zod issue>`.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/bucket-assistant/tools.ts tests/bucket-assistant-tools.test.ts
git add lib/bucket-assistant/tools.ts tests/bucket-assistant-tools.test.ts
git commit -m "Bucket assistant: read and propose tools"
```

### Task 8: System prompt and agent loop

**Files:**
- Create: `lib/bucket-assistant/prompt.ts`
- Create: `lib/bucket-assistant/run.ts`
- Create: `lib/bucket-assistant/errors.ts`
- Test: `tests/bucket-assistant-run.test.ts`

**Interfaces:**
- Consumes: Task 3's `applyOps`, `proposalWarnings`, `describeOp`; Task 6's contract types; Task 7's `createWorkspace`, `TOOLS`, `runTool`.
- Produces:
  ```ts
  // prompt.ts
  buildSystemPrompt(input: { appName: string; state: BucketsState; ownerAccess: string | null; notes: string[] }): string
  // run.ts
  const MAX_MODEL_CALLS = 8, MAX_TOOL_FAILURES = 3
  type CallModel = (request: { messages: ChatMessage[]; tools: ChatTool[] }) =>
    Promise<{ message: ChatMessage; inputTokens: number; outputTokens: number; costUsd?: number }>
  runAssistantTurn(options: { data: BucketsData; appName: string; input: AssistantTurnInput; callModel: CallModel }):
    Promise<AssistantTurnResult>
  // errors.ts
  assistantErrorMessage(error: unknown, runsOn: string): string
  ```
- **Prompt:** follow the spec's outline, rules and the mixed-kind rule. `notes` lists dropped pending ops as `` `An earlier proposed change no longer applies and was dropped: ${line} (${error})` ``.
- **Loop:** follow the spec's "Loop" section.
  - Pending ops are replayed with `applyOps`. The skipped ones become notes, and `proposal.ops` starts with the applied ones.
  - `proposal.lines` come from `describeOp`. `proposal.warnings` come from `proposalWarnings(finalState, ops, ctx)`.
  - Usage sums over all calls. `costUsd` is undefined if any call's cost was undefined.
- **Fixed reply copy:**
  - Cap reached: `I stopped after 8 steps. Ask me to continue if the proposal isn't finished.` (appended after any reply text, separated by a blank line).
  - 3 failures in a row: `I kept getting the tools wrong, so I stopped. Try again, or pick another model in Runs on.`
  - Empty reply with no question: `I couldn't come up with an answer. Try rephrasing, or pick another model in Runs on.`
- **`assistantErrorMessage`:**
  - A `GatewayError` with status 400 and `/tool/i` in its message → `` `${runsOn} couldn't use the assistant's tools. Try another model in Runs on.` ``
  - Any other `GatewayError` → its message.
  - `ClientAbortError`, or an `Error` named `AbortError`/`TimeoutError` → `The assistant took too long. Try again.`
  - Anything else → `Something went wrong. Try again.`

- [ ] **Step 1: Write the failing tests** with a scripted fake `callModel` that returns queued messages and records each request.
  - Plain reply: `reply` "Hi", no ops, `usage.calls` 1, and the first request's `messages[0].role` is "system".
  - A tool call, then a reply: one op in the proposal; the steps include its line; the second request carries a `role: "tool"` message with the matching `tool_call_id`.
  - `ask_user` alone: a `question` comes back, and `callModel` ran once.
  - **Change and question in one message (Review Focus 2):** one assistant message holds both `create_bucket` and `ask_user` → `question` is set, `proposal.ops.length` is 1, and there was 1 call.
  - The cap: `list_buckets` every time gives 8 calls and a reply ending with the cap copy.
  - Failures: an unknown tool every time gives 3 calls and the failure copy.
  - Replay: a pending `create_bucket "embed"` shows up in `list_buckets` during the turn and is `proposal.ops[0]`.
  - Stale op: a pending `add_models` to `"gone"` is dropped, and `messages[0].content` contains "no longer applies".
  - Empty reply: gives the fallback copy.
  - Warnings: proposing a mixed bucket gives a `proposal.warnings` entry for it.
  - `assistantErrorMessage`: one case per branch.

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- tests/bucket-assistant-run.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the three files.**

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write lib/bucket-assistant/prompt.ts lib/bucket-assistant/run.ts lib/bucket-assistant/errors.ts tests/bucket-assistant-run.test.ts
git add lib/bucket-assistant/prompt.ts lib/bucket-assistant/run.ts lib/bucket-assistant/errors.ts tests/bucket-assistant-run.test.ts
git commit -m "Bucket assistant: system prompt and agent loop"
```

### Task 9: Server actions

**Files:**
- Create: `app/(dashboard)/apps/[id]/assistant-actions.ts`

**Interfaces:**
- Consumes: Task 5's `requireAppAccess`, `isDenied`, `loadBucketsData`, `runChatAsApp`; Task 6's schema, `buildAssistantOptions`, `isAllowedRunsOn`; Task 8's `runAssistantTurn`, `assistantErrorMessage`; `loadAppContext`; `createClient` from `@/lib/supabase/server`.
- Produces (`"use server"`, async exports only):
  ```ts
  getAssistantOptions(appId: string): Promise<ActionResult<AssistantOptions>>
  askBucketAssistant(appId: string, input: AssistantTurnInput): Promise<ActionResult<AssistantTurnResult>>
  ```
- `askBucketAssistant` runs these steps in order:
  1. `requireAppAccess`.
  2. Parse the input with `assistantTurnInputSchema`. On failure, return the first issue's message.
  3. Load the app row (`id, name, owner_email, default_model, only_bucket_models`) with `createClient()`.
  4. `loadBucketsData`.
  5. `buildAssistantOptions`. If `isAllowedRunsOn` fails, return `Pick a model from the list`.
  6. `loadAppContext(appId)`. If there's none, return `Unknown app`.
  7. `signal = AbortSignal.timeout(120_000)`.
  8. Define `callModel` as `runChatAsApp({ request: { model: runsOn, messages, tools, tool_choice: "auto", temperature: 0.2 }, context, runnerEmail: me.email, endpoint: "bucket-assistant", signal })`.
  9. `runAssistantTurn`.
  10. Catch any error → `{ ok: false, error: assistantErrorMessage(error, runsOn) }`.

- [ ] **Step 1: Implement both actions.**

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p . && npx eslint "app/(dashboard)/apps/[id]/assistant-actions.ts" && npm test`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Commit**

```bash
npx prettier --write "app/(dashboard)/apps/[id]/assistant-actions.ts"
git add "app/(dashboard)/apps/[id]/assistant-actions.ts"
git commit -m "Bucket assistant: server actions"
```

### Task 10: Assistant panel

**Files:**
- Create: `app/(dashboard)/apps/[id]/assistant-panel.tsx` (`"use client"`)
- Modify: `app/(dashboard)/apps/[id]/models-section.tsx` (add `applyAssistantOps`, panel state, render the panel)
- Modify: `app/(dashboard)/apps/[id]/buckets-board.tsx` (new prop `onOpenAssistant: () => void`; **Ask assistant** button with `SparklesIcon`, `variant="outline"`, before **New bucket**, `data-tour="app-assistant"`)
- Temporary (deleted in this task): `app/auth/zz-preview-buckets/page.tsx`

**Interfaces:**
- Consumes: Task 3's `applyOps`, `opContext`, `describeOp`; Task 4's `toInput`, `stateToBoard`; Task 6's types; Task 9's actions.
- Produces:
  ```ts
  interface ApplyOutcome { applied: number; skipped: { line: string; error: string }[] }
  AssistantPanel(props: { open: boolean; onOpenChange: (open: boolean) => void; appId: string;
    models: BucketModel[]; getBoardState: () => BucketsState; onApply: (ops: AssistantOp[]) => ApplyOutcome;
    ask: (input: AssistantTurnInput) => Promise<ActionResult<AssistantTurnResult>>;
    loadOptions: () => Promise<ActionResult<AssistantOptions>> })
  ```
  `ModelsSection` binds `ask`/`loadOptions` to the server actions with `appId`. The preview injects fakes.
- **`applyAssistantOps(ops)`:**
  1. Run `applyOps(toInput(boardRef.current), ops, opContext(data.models, data.addable))`.
  2. `update((prev) => stateToBoard(result.state, prev))`. The normal auto-save follows.
  3. Show `` toast.success(`Applied ${n} change${n === 1 ? "" : "s"}`) ``.
  4. Return the outcome with `describeOp` lines for the skipped ops.
- **Sheet:** `SheetContent` with `side="right"` and `className="w-full gap-0 p-0 sm:w-[420px]"`.
- **Header:**
  - Title `Bucket assistant`.
  - `Runs on` `Select`: group "This app's buckets", then one group per provider. Each item shows its name and its price via `ModelPrice` (`@/components/model-price`), which reads Free for free models. A note sits under the select when `!toolsKnown`: `None of your models are marked for tool calling. The assistant may not work.`
  - `New chat` button.
- **Runs on persistence:** `localStorage` key `` `bucket-assistant:runs-on:${appId}` ``, read and written in try/catch. If the stored value isn't in the options, use the first option (Review Focus 5).
- **Empty chat:** starter buttons `Make an embeddings bucket`, `Free chat bucket with fallbacks`, `Cheapest coding bucket`, `Review my buckets`.
- **Messages:** inside `ScrollArea`, kept scrolled to the end.
  - User text, and assistant text in `whitespace-pre-wrap`.
  - Steps as muted `text-xs` lines.
  - The question's options as `variant="outline" size="sm"` buttons, disabled once answered.
  - Errors as an `Alert variant="destructive"` with a `Retry` button.
  - `Thinking…` with `Spinner` while a turn runs.
- **Proposal card:** the latest proposal with `ops.length > 0`.
  - Contents: title `Proposed changes`, then `lines` as a numbered list.
  - Each warning as `Alert variant="destructive"` (title and body).
  - Buttons: `Discard`, then `Apply`, or `Apply anyway` with `variant="destructive"` when there are warnings.
  - After Apply it says `Applied`, followed by `Skipped: <line> (<error>)` for each skipped step. After Discard it says `Discarded`.
  - Applying or discarding clears the pending ops.
- **Sending:**
  - `messages` = the last 20 entries as `{ role, content }`. An assistant entry's content is its reply plus `\n\n<question text>` when it asked one.
  - `board` = `getBoardState()`.
  - `pendingOps` = the open proposal's ops, or `[]`.
- **Footer:** a `Textarea` with `maxLength={4000}` and placeholder `Ask about your buckets…`. Enter sends and Shift+Enter adds a new line; it's disabled while a turn runs. Below it, the muted note `Runs on your models; billed to this app.`

- [ ] **Step 1: Build the panel, wire `ModelsSection` and the board button.**

- [ ] **Step 2: Typecheck and lint.** Run: `npx tsc --noEmit -p . && npx eslint "app/(dashboard)/apps/[id]"`. Expected: exit 0.

- [ ] **Step 3: Visual and interaction check.** Recreate the preview route from Task 2, Step 6. It renders `ModelsSection`-like wiring: board state plus `AssistantPanel` with fake `loadOptions` and a fake `ask`. The fake `ask` returns:
  1. First, a reply and a question with options `Free only` / `Cheapest paid`.
  2. Then a proposal that creates `embed` with one chat and one embedding model, so the warning shows.

  Drive it with a CDP script (Node 24's built-in `WebSocket` against `--remote-debugging-port`):
  1. Open the panel and click a starter.
  2. Click `Free only`.
  3. Screenshot the proposal.
  4. Click `Apply anyway`.
  5. Read the board lanes from the DOM.

  Expected:
  - The question buttons and the red warning appear.
  - The button reads `Apply anyway`.
  - After Apply, the board has an `embed` lane showing the mixed-kind banner, and the card says `Applied`.
  - At width 500, the panel fills the width and the page has no horizontal scroll (`scrollWidth === clientWidth`).

- [ ] **Step 4: Remove the preview** as in Task 2, Step 7.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "app/(dashboard)/apps/[id]/assistant-panel.tsx" "app/(dashboard)/apps/[id]/models-section.tsx" "app/(dashboard)/apps/[id]/buckets-board.tsx"
git add "app/(dashboard)/apps/[id]/assistant-panel.tsx" "app/(dashboard)/apps/[id]/models-section.tsx" "app/(dashboard)/apps/[id]/buckets-board.tsx"
git commit -m "Bucket assistant: chat panel on the Models tab"
```

### Task 11: Whole-feature check and hand-off

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `npm test && npx tsc --noEmit -p . && npx eslint app lib tests && git status --short`
Expected: all tests pass, no type or lint errors, and a clean tree (everything committed).

- [ ] **Step 2: Hand-off.** Report the commits to the user, and ask them to run one live chat in local dev (`npx next dev`, signed in with 2FA):
  - on a free tool-capable model;
  - creating an embeddings bucket;
  - checking that the request appears in Logs as `bucket-assistant` under the app.

  Don't push until they ask.
