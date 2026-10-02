"use client"

import { useMemo, useState } from "react"
import {
  AlertCircleIcon,
  AudioLinesIcon,
  BracesIcon,
  BrainIcon,
  CheckIcon,
  CircleDashedIcon,
  CloudAlertIcon,
  DatabaseZapIcon,
  EllipsisIcon,
  EyeIcon,
  FileTextIcon,
  GripVerticalIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/animate-ui/components/radix/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"
import { ModelPrice } from "@/components/model-price"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from "@/components/ui/kanban"
import { Spinner } from "@/components/ui/spinner"
import { formatCompact, formatUsd } from "@/lib/format"
import { CAPABILITY_LABELS, type Capability } from "@/lib/providers/catalog"
import { cn } from "@/lib/utils"

import {
  BUCKET_NAME_PATTERN,
  MAX_BUCKET_MODELS,
  MAX_BUCKETS,
  toBucketName,
} from "../_lib"
import { MODEL_DRAG_TYPE, type BucketModel } from "./buckets-shared"
import type { Board, BoardItem, SaveState } from "./models-section"

const CAPABILITY_ICONS: Record<Capability, LucideIcon> = {
  tools: WrenchIcon,
  vision: EyeIcon,
  json_schema: BracesIcon,
  reasoning: BrainIcon,
  pdf: FileTextIcon,
  audio: AudioLinesIcon,
  prompt_caching: DatabaseZapIcon,
}

const NAME_SUGGESTIONS = ["smart", "fast", "cheap", "free", "paid", "coding"]

interface DragHandlers {
  onColumnsChange: (columns: Board["columns"]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragCancel: () => void
}

export function BucketsBoard({
  board,
  modelsById,
  addable,
  ownerAccess,
  saveState,
  onRetrySave,
  onAddModel,
  onRemoveModel,
  onCreateBucket,
  onRenameBucket,
  onDeleteBucket,
  onSetDefault,
  onSetOnlyBuckets,
  drag,
}: {
  board: Board
  modelsById: Map<string, BucketModel>
  addable: string[]
  ownerAccess: string | null
  saveState: SaveState
  onRetrySave: () => void
  onAddModel: (bucketKey: string, modelId: string) => void
  onRemoveModel: (bucketKey: string, itemKey: string) => void
  onCreateBucket: (name: string) => void
  onRenameBucket: (key: string, name: string) => void
  onDeleteBucket: (key: string) => void
  onSetDefault: (key: string | null) => void
  onSetOnlyBuckets: (value: boolean) => void
  drag: DragHandlers
}) {
  const [creating, setCreating] = useState(false)
  const keys = Object.keys(board.columns)
  const names = Object.values(board.names)
  const itemsByKey = useMemo(() => {
    const map = new Map<string, BoardItem>()
    for (const items of Object.values(board.columns)) {
      for (const item of items) map.set(item.key, item)
    }
    return map
  }, [board.columns])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Buckets
          <SaveIndicator state={saveState} onRetry={onRetrySave} />
        </CardTitle>
        <CardDescription>
          Name a group of models, then call it like a model:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            model: &quot;smart&quot;
          </code>
          . Models are tried top to bottom. When one fails, is rate-limited or
          is cooling down, the next one answers. Drag to reorder. Changes reach
          API calls within 30 seconds.
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={keys.length >= MAX_BUCKETS}
          >
            <PlusIcon />
            New bucket
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        {keys.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon />
              </EmptyMedia>
              <EmptyTitle>No buckets yet</EmptyTitle>
              <EmptyDescription>
                Create one, like &quot;smart&quot; or &quot;free&quot;, then
                drag models into it from the table below.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                {NAME_SUGGESTIONS.slice(0, 4).map((name) => (
                  <Button
                    key={name}
                    variant="outline"
                    size="sm"
                    onClick={() => onCreateBucket(name)}
                  >
                    <PlusIcon />
                    {name}
                  </Button>
                ))}
              </div>
            </EmptyContent>
          </Empty>
        ) : (
          <Kanban
            value={board.columns}
            onValueChange={drag.onColumnsChange}
            getItemValue={(item) => item.key}
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
            onDragCancel={drag.onDragCancel}
          >
            <KanbanBoard className="h-auto items-start overflow-x-auto pb-2">
              {keys.map((key) => (
                <BucketColumn
                  key={key}
                  bucketKey={key}
                  name={board.names[key] ?? ""}
                  items={board.columns[key] ?? []}
                  isDefault={board.defaultKey === key}
                  modelsById={modelsById}
                  addable={addable}
                  otherNames={names.filter((n) => n !== board.names[key])}
                  onAddModel={onAddModel}
                  onRemoveModel={onRemoveModel}
                  onRename={onRenameBucket}
                  onDelete={onDeleteBucket}
                  onSetDefault={onSetDefault}
                />
              ))}
            </KanbanBoard>
            <KanbanOverlay>
              {({ value, variant }) => {
                if (variant === "column") {
                  return <div className="size-full rounded-xl bg-primary/10" />
                }
                const item = itemsByKey.get(String(value))
                const model = item ? modelsById.get(item.modelId) : undefined
                return model ? <ModelCardBody model={model} overlay /> : null
              }}
            </KanbanOverlay>
          </Kanban>
        )}

        <Field
          orientation="horizontal"
          className="rounded-lg border bg-muted/30 p-4"
        >
          <FieldContent>
            <FieldLabel htmlFor="only-bucket-models">
              Only allow models in these buckets
            </FieldLabel>
            <FieldDescription>
              {board.onlyBuckets
                ? "This app's keys can call the buckets above and the models inside them, nothing else."
                : `This app's keys can also call any other model by its slug${ownerAccess ? ` (${ownerAccess})` : ""}.`}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="only-bucket-models"
            checked={board.onlyBuckets}
            onCheckedChange={onSetOnlyBuckets}
          />
        </Field>
      </CardContent>

      <BucketNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New bucket"
        description="Your code calls the bucket by this name. Lowercase letters, numbers, dots, dashes and underscores."
        submitLabel="Create bucket"
        initialName=""
        takenNames={names}
        suggestions={NAME_SUGGESTIONS.filter((n) => !names.includes(n))}
        onSubmit={(name) => {
          onCreateBucket(name)
          setCreating(false)
        }}
      />
    </Card>
  )
}

function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveState
  onRetry: () => void
}) {
  if (state === "idle") return null
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-xs font-normal text-destructive hover:underline"
      >
        <AlertCircleIcon className="size-3.5" />
        Not saved. Retry
      </button>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"
      aria-live="polite"
    >
      {state === "saved" ? (
        <>
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          Saved
        </>
      ) : (
        <>
          <Spinner className="size-3" />
          Saving…
        </>
      )}
    </span>
  )
}

function BucketColumn({
  bucketKey,
  name,
  items,
  isDefault,
  modelsById,
  addable,
  otherNames,
  onAddModel,
  onRemoveModel,
  onRename,
  onDelete,
  onSetDefault,
}: {
  bucketKey: string
  name: string
  items: BoardItem[]
  isDefault: boolean
  modelsById: Map<string, BucketModel>
  addable: string[]
  otherNames: string[]
  onAddModel: (bucketKey: string, modelId: string) => void
  onRemoveModel: (bucketKey: string, itemKey: string) => void
  onRename: (key: string, name: string) => void
  onDelete: (key: string) => void
  onSetDefault: (key: string | null) => void
}) {
  const [dropping, setDropping] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const full = items.length >= MAX_BUCKET_MODELS

  return (
    <KanbanColumn
      value={bucketKey}
      className={cn(
        "w-76 shrink-0 gap-3 rounded-xl bg-muted/40 p-3 transition-colors dark:bg-muted/20",
        dropping && "border-primary bg-primary/5 ring-2 ring-primary/30"
      )}
      // Rows dragged from the model table (native drag and drop).
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(MODEL_DRAG_TYPE) || full) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropping(false)
      }}
      onDrop={(event) => {
        const modelId = event.dataTransfer.getData(MODEL_DRAG_TYPE)
        setDropping(false)
        if (!modelId) return
        event.preventDefault()
        onAddModel(bucketKey, modelId)
      }}
    >
      <div className="flex items-start gap-1.5">
        <KanbanColumnHandle asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-0.5 size-6 cursor-grab text-muted-foreground"
            aria-label={`Move bucket ${name}`}
          >
            <GripVerticalIcon />
          </Button>
        </KanbanColumnHandle>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-sm font-semibold">
              {name}
            </span>
            {isDefault && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="gap-1 px-1.5" variant="secondary">
                    <StarIcon className="size-3 fill-amber-400 text-amber-500" />
                    Default
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Used when a request has no model, or the model
                  &quot;default&quot;
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono">model: &quot;{name}&quot;</span>
            <CopyButton
              content={name}
              variant="ghost"
              size="xs"
              aria-label={`Copy ${name}`}
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={`Bucket ${name} options`}
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => onSetDefault(isDefault ? null : bucketKey)}
            >
              <StarIcon />
              {isDefault ? "Remove as default" : "Make default"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                items.length ? setDeleting(true) : onDelete(bucketKey)
              }
            >
              <Trash2Icon />
              Delete bucket
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-24 flex-col gap-2">
        {items.map((item, index) => {
          const model = modelsById.get(item.modelId)
          return (
            <KanbanItem key={item.key} value={item.key} asChild>
              <div className="rounded-lg">
                {model ? (
                  <ModelCardBody
                    model={model}
                    position={index + 1}
                    onRemove={() => onRemoveModel(bucketKey, item.key)}
                  />
                ) : (
                  <MissingModelCard
                    onRemove={() => onRemoveModel(bucketKey, item.key)}
                  />
                )}
              </div>
            </KanbanItem>
          )
        })}
        {items.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            <CircleDashedIcon className="size-4" />
            Drop models here
          </div>
        )}
      </div>

      <AddModelPopover
        disabled={full}
        modelsById={modelsById}
        addable={addable}
        inBucket={new Set(items.map((item) => item.modelId))}
        onPick={(modelId) => onAddModel(bucketKey, modelId)}
      />

      <BucketNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${name}`}
        description="Clients calling the old name will get an error until they switch to the new one."
        submitLabel="Rename"
        initialName={name}
        takenNames={otherNames}
        suggestions={[]}
        onSubmit={(next) => {
          onRename(bucketKey, next)
          setRenaming(false)
        }}
      />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {name} bucket?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests for model &quot;{name}&quot; will fail. The{" "}
              {items.length} model{items.length === 1 ? "" : "s"} in it stay
              available to add to other buckets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => onDelete(bucketKey)}
            >
              Delete bucket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </KanbanColumn>
  )
}

/** A model in a bucket: chain position, price, health and this month's use. */
export function ModelCardBody({
  model,
  position,
  onRemove,
  overlay = false,
}: {
  model: BucketModel
  position?: number
  onRemove?: () => void
  overlay?: boolean
}) {
  const unavailable = model.status.kind === "unavailable"
  return (
    <div
      className={cn(
        "group/card rounded-lg border bg-card p-2.5 shadow-xs",
        overlay && "w-76 rotate-1 shadow-lg ring-2 ring-primary/30",
        unavailable && "border-dashed opacity-70"
      )}
    >
      <div className="flex items-start gap-2">
        {overlay ? (
          <span className="mt-0.5 text-muted-foreground">
            <GripVerticalIcon className="size-4" />
          </span>
        ) : (
          <KanbanItemHandle asChild>
            <button
              type="button"
              className="mt-0.5 cursor-grab rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Move ${model.name}`}
            >
              <GripVerticalIcon className="size-4" />
            </button>
          </KanbanItemHandle>
        )}
        {position !== undefined && (
          <span
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular-nums"
            title={
              position === 1 ? "Tried first" : `Tried ${ordinal(position)}`
            }
          >
            {position}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusDot model={model} />
            <span className="truncate text-sm font-medium">{model.name}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {model.provider}
            {model.own && " · your provider"}
            {model.kind === "embedding" && " · embedding"}
          </div>
        </div>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground opacity-60 group-hover/card:opacity-100"
            aria-label={`Remove ${model.name}`}
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <ModelPrice input={model.inputPrice} output={model.outputPrice} />
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {model.contextWindow ? (
            <span className="tabular-nums">
              {formatCompact(model.contextWindow)} ctx
            </span>
          ) : null}
          <CapabilityIcons capabilities={model.capabilities} />
        </div>
      </div>

      <UsageStrip model={model} />
    </div>
  )
}

function ordinal(n: number) {
  const suffix =
    n % 10 === 2 && n % 100 !== 12
      ? "nd"
      : n % 10 === 3 && n % 100 !== 13
        ? "rd"
        : n % 10 === 1 && n % 100 !== 11
          ? "st"
          : "th"
  return `${n}${suffix}`
}

function MissingModelCard({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed bg-card p-2.5 text-xs text-muted-foreground">
      <KanbanItemHandle asChild>
        <button
          type="button"
          className="cursor-grab"
          aria-label="Move deleted model"
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </KanbanItemHandle>
      <CloudAlertIcon className="size-4" />
      <span className="flex-1">This model was deleted from the gateway.</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6"
        aria-label="Remove deleted model"
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  )
}

export function StatusDot({ model }: { model: BucketModel }) {
  const { status } = model
  const label =
    status.kind === "ok" ? "Healthy: answering normally" : status.label
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            status.kind === "ok" && "bg-emerald-500",
            status.kind === "cooling" && "bg-amber-500",
            status.kind === "unavailable" && "bg-muted-foreground/50"
          )}
          aria-label={label}
          role="img"
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CapabilityIcons({
  capabilities,
}: {
  capabilities: Capability[]
}) {
  if (!capabilities.length) return null
  return (
    <span className="flex items-center gap-1">
      {capabilities.map((capability) => {
        const Icon = CAPABILITY_ICONS[capability]
        if (!Icon) return null
        return (
          <Tooltip key={capability}>
            <TooltipTrigger asChild>
              <Icon
                className="size-3.5"
                aria-label={CAPABILITY_LABELS[capability]}
              />
            </TooltipTrigger>
            <TooltipContent>{CAPABILITY_LABELS[capability]}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}

function UsageStrip({ model }: { model: BucketModel }) {
  const usage = model.usage
  if (model.status.kind !== "ok") {
    return (
      <p
        className={cn(
          "mt-2 rounded-md px-2 py-1 text-xs",
          model.status.kind === "cooling"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground"
        )}
      >
        {model.status.label}
      </p>
    )
  }
  if (!usage?.requests) {
    return (
      <p className="mt-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
        Not used this month
      </p>
    )
  }
  return (
    <dl className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-muted/60 px-2 py-1 text-xs">
      <div>
        <dt className="text-muted-foreground">Requests</dt>
        <dd className="font-medium tabular-nums">
          {formatCompact(usage.requests)}
          {usage.errors > 0 && (
            <span className="text-destructive">
              {" "}
              · {formatCompact(usage.errors)} err
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Tokens</dt>
        <dd className="font-medium tabular-nums">
          {formatCompact(usage.tokens)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Cost</dt>
        <dd className="font-medium tabular-nums">{formatUsd(usage.costUsd)}</dd>
      </div>
    </dl>
  )
}

function AddModelPopover({
  disabled,
  modelsById,
  addable,
  inBucket,
  onPick,
}: {
  disabled: boolean
  modelsById: Map<string, BucketModel>
  addable: string[]
  inBucket: Set<string>
  onPick: (modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const options = addable
    .filter((id) => !inBucket.has(id))
    .map((id) => modelsById.get(id))
    .filter((model): model is BucketModel => Boolean(model))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          disabled={disabled}
        >
          <PlusIcon />
          {disabled ? `Full (${MAX_BUCKET_MODELS} models)` : "Add model"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No other models to add.</CommandEmpty>
            <CommandGroup>
              {options.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.slug} ${model.provider}`}
                  onSelect={() => {
                    onPick(model.id)
                    setOpen(false)
                  }}
                >
                  <StatusDot model={model} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{model.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {model.provider}
                    </div>
                  </div>
                  <span className="text-xs">
                    <ModelPrice
                      input={model.inputPrice}
                      output={model.outputPrice}
                    />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function BucketNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName,
  takenNames,
  suggestions,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  initialName: string
  takenNames: string[]
  suggestions: string[]
  onSubmit: (name: string) => void
}) {
  const [value, setValue] = useState(initialName)
  const name = toBucketName(value)
  const problem = !name
    ? null
    : name === "default"
      ? '"default" is reserved: clients send it to mean the default bucket'
      : !BUCKET_NAME_PATTERN.test(name)
        ? "Start with a letter or number"
        : takenNames.includes(name)
          ? "Another bucket already has this name"
          : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(initialName)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name && !problem) onSubmit(name)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={problem ? true : undefined}>
            <FieldLabel htmlFor="bucket-name">Name</FieldLabel>
            <Input
              id="bucket-name"
              autoFocus
              autoComplete="off"
              maxLength={40}
              placeholder="smart"
              className="font-mono"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={problem ? true : undefined}
            />
            {problem ? (
              <FieldError>{problem}</FieldError>
            ) : name && name !== value.trim() ? (
              <FieldDescription>
                Saved as <span className="font-mono">{name}</span>
              </FieldDescription>
            ) : null}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 font-mono text-xs"
                    onClick={() => setValue(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            )}
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={!name || Boolean(problem)}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
