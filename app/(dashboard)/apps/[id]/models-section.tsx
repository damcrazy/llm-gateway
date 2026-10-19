"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  applyOps,
  describeOp,
  opContext,
  type AssistantOp,
} from "@/lib/bucket-assistant/ops"
import { offKindToast } from "@/lib/bucket-kinds"

import { saveAppBuckets } from "../actions"
import { askBucketAssistant, getAssistantOptions } from "./assistant-actions"
import { AssistantPanel, type ApplyOutcome } from "./assistant-panel"
import {
  duplicateIn,
  initialBoard,
  makeKey,
  stateToBoard,
  toInput,
  type Board,
  type BucketSettings,
  type SaveState,
} from "./board-state"
import { BucketsBoard } from "./buckets-board"
import type { BucketsData } from "./buckets-shared"
import { ModelLibrary } from "./model-library"

const SAVE_DELAY_MS = 500

/**
 * The app's Models tab: named buckets of models (drag to order them; the
 * order is the fallback chain) and the table of models to add from. Every
 * change saves automatically.
 */
export function ModelsSection({
  appId,
  data,
}: {
  appId: string
  data: BucketsData
}) {
  const [board, setBoard] = useState(() => initialBoard(data))
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const boardRef = useRef(board)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const version = useRef(0)
  const dragging = useRef(false)
  const dragStart = useRef<Board | null>(null)

  const modelsById = useMemo(
    () => new Map(data.models.map((model) => [model.id, model])),
    [data.models]
  )

  useEffect(() => () => clearTimeout(timer.current), [])

  const save = useCallback(async () => {
    const mine = ++version.current
    setSaveState("saving")
    const result = await saveAppBuckets(appId, toInput(boardRef.current))
    if (mine !== version.current) return
    if (result.ok) {
      setSaveState("saved")
    } else {
      setSaveState("error")
      toast.error(result.error)
    }
  }, [appId])

  const scheduleSave = useCallback(() => {
    clearTimeout(timer.current)
    setSaveState("pending")
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
  }, [save])

  const update = useCallback(
    (recipe: (current: Board) => Board) => {
      const next = recipe(boardRef.current)
      boardRef.current = next
      setBoard(next)
      // Mid-drag changes are saved once the drag ends.
      if (!dragging.current) scheduleSave()
    },
    [scheduleSave]
  )

  const nameOf = useCallback(
    (modelId: string) => modelsById.get(modelId)?.name ?? "This model",
    [modelsById]
  )

  const addModel = useCallback(
    (bucketKey: string, modelId: string) => {
      const current = boardRef.current
      const items = current.columns[bucketKey]
      if (!items) return
      const bucketName = current.names[bucketKey]
      if (items.some((item) => item.modelId === modelId)) {
        toast.info(`${nameOf(modelId)} is already in ${bucketName}`)
        return
      }
      update((b) => ({
        ...b,
        columns: {
          ...b.columns,
          [bucketKey]: [
            ...(b.columns[bucketKey] ?? []),
            { key: makeKey(`${modelId}@`), modelId },
          ],
        },
      }))
      // Chat requests skip embedding models and vice versa: say so loudly.
      const primary = items
        .map((item) => modelsById.get(item.modelId)?.kind)
        .find(Boolean)
      const kind = modelsById.get(modelId)?.kind
      if (primary && kind && kind !== primary) {
        toast.warning(
          offKindToast(nameOf(modelId), kind, bucketName ?? "", primary)
        )
      } else {
        toast.success(`Added ${nameOf(modelId)} to ${bucketName}`)
      }
    },
    [update, nameOf, modelsById]
  )

  const removeModel = useCallback(
    (bucketKey: string, itemKey: string) =>
      update((b) => ({
        ...b,
        columns: {
          ...b.columns,
          [bucketKey]: (b.columns[bucketKey] ?? []).filter(
            (item) => item.key !== itemKey
          ),
        },
      })),
    [update]
  )

  const createBucket = useCallback(
    (name: string, modelIds: string[] = []) => {
      const key = makeKey("bucket-")
      update((b) => ({
        ...b,
        columns: {
          ...b.columns,
          [key]: modelIds.map((modelId) => ({
            key: makeKey(`${modelId}@`),
            modelId,
          })),
        },
        names: { ...b.names, [key]: name },
        settings: {
          ...b.settings,
          [key]: { strategy: "ordered", hedgeAfterMs: null },
        },
        // The first bucket becomes the default.
        defaultKey: b.defaultKey ?? key,
      }))
    },
    [update]
  )

  const renameBucket = useCallback(
    (key: string, name: string) =>
      update((b) => ({ ...b, names: { ...b.names, [key]: name } })),
    [update]
  )

  const deleteBucket = useCallback(
    (key: string) =>
      update((b) => {
        const columns = { ...b.columns }
        const names = { ...b.names }
        const settings = { ...b.settings }
        delete columns[key]
        delete names[key]
        delete settings[key]
        return {
          ...b,
          columns,
          names,
          settings,
          defaultKey: b.defaultKey === key ? null : b.defaultKey,
        }
      }),
    [update]
  )

  const setBucketSettings = useCallback(
    (key: string, next: Partial<BucketSettings>) =>
      update((b) => ({
        ...b,
        settings: {
          ...b.settings,
          [key]: {
            ...(b.settings[key] ?? { strategy: "ordered", hedgeAfterMs: null }),
            ...next,
          },
        },
      })),
    [update]
  )

  const setDefault = useCallback(
    (key: string | null) => update((b) => ({ ...b, defaultKey: key })),
    [update]
  )

  const setOnlyBuckets = useCallback(
    (onlyBuckets: boolean) => update((b) => ({ ...b, onlyBuckets })),
    [update]
  )

  const drag = useMemo(
    () => ({
      onColumnsChange: (columns: Board["columns"]) =>
        update((b) => ({ ...b, columns })),
      onDragStart: () => {
        dragging.current = true
        dragStart.current = boardRef.current
      },
      onDragEnd: () => {
        // Kanban applies the final reorder right after this callback.
        setTimeout(() => {
          dragging.current = false
          const duplicateKey = duplicateIn(boardRef.current)
          if (duplicateKey && dragStart.current) {
            const restored = dragStart.current
            boardRef.current = restored
            setBoard(restored)
            toast.info(
              `That model is already in ${restored.names[duplicateKey] ?? "that bucket"}`
            )
            return
          }
          scheduleSave()
        }, 0)
      },
      onDragCancel: () => {
        dragging.current = false
        if (dragStart.current) {
          boardRef.current = dragStart.current
          setBoard(dragStart.current)
        }
      },
    }),
    [update, scheduleSave]
  )

  const [assistantOpen, setAssistantOpen] = useState(false)

  /** Apply the assistant's proposal to the board as it is now. */
  const applyAssistantOps = useCallback(
    (ops: AssistantOp[]): ApplyOutcome => {
      const result = applyOps(
        toInput(boardRef.current),
        ops,
        opContext(data.models, data.addable)
      )
      if (result.applied.length)
        update((previous) => stateToBoard(result.state, previous))
      const n = result.applied.length
      if (n) toast.success(`Applied ${n} change${n === 1 ? "" : "s"}`)
      return {
        applied: n,
        skipped: result.skipped.map(({ op, error }) => ({
          line: describeOp(op, nameOf),
          error,
        })),
      }
    },
    [data.models, data.addable, update, nameOf]
  )

  const getBoardState = useCallback(() => toInput(boardRef.current), [])
  const ask = useCallback(
    (input: Parameters<typeof askBucketAssistant>[1]) =>
      askBucketAssistant(appId, input),
    [appId]
  )
  const loadOptions = useCallback(() => getAssistantOptions(appId), [appId])

  const bucketList = useMemo(
    () =>
      Object.entries(board.columns).map(([key, items]) => ({
        key,
        name: board.names[key] ?? "",
        modelIds: items.map((item) => item.modelId),
      })),
    [board]
  )

  return (
    <div className="grid min-w-0 gap-6">
      <BucketsBoard
        board={board}
        modelsById={modelsById}
        addable={data.addable}
        ownerAccess={data.ownerAccess}
        saveState={saveState}
        onRetrySave={() => void save()}
        onAddModel={addModel}
        onRemoveModel={removeModel}
        onCreateBucket={createBucket}
        onRenameBucket={renameBucket}
        onDeleteBucket={deleteBucket}
        onSetDefault={setDefault}
        onSetBucketSettings={setBucketSettings}
        onSetOnlyBuckets={setOnlyBuckets}
        drag={drag}
        onOpenAssistant={() => setAssistantOpen(true)}
      />
      <AssistantPanel
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        appId={appId}
        getBoardState={getBoardState}
        onApply={applyAssistantOps}
        ask={ask}
        loadOptions={loadOptions}
      />
      <ModelLibrary
        models={data.models}
        addable={data.addable}
        buckets={bucketList}
        onAddModel={addModel}
        onCreateBucket={createBucket}
      />
    </div>
  )
}
