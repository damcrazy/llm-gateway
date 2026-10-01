"use client"

import { useOptimistic, useState, useTransition } from "react"
import {
  ActivityIcon,
  FlaskConicalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  SnowflakeIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { formatMs } from "@/lib/format"
import { CAPABILITY_LABELS, type Capability } from "@/lib/providers/catalog"

import {
  deleteModel,
  resetModelHealth,
  runModelTest,
  setModelEnabled,
} from "./actions"
import { ModelFormDialog } from "./model-form-dialog"
import type { ModelHealthSummary, ModelListItem } from "./shared"

export function CapabilityBadges({
  capabilities,
}: {
  capabilities: Capability[]
}) {
  if (!capabilities.length)
    return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {capabilities.map((capability) => (
        <Badge key={capability} variant="secondary" className="font-normal">
          {CAPABILITY_LABELS[capability] ?? capability}
        </Badge>
      ))}
    </div>
  )
}

export function TagBadges({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline" className="font-normal">
          {tag}
        </Badge>
      ))}
    </div>
  )
}

export function HealthBadge({ health }: { health: ModelHealthSummary | null }) {
  if (!health?.coolingDown) {
    const failures = health?.consecutiveFailures ?? 0
    const hasDetails = Boolean(failures && health?.lastError)
    const badge = (
      <Badge
        variant="outline"
        className="font-normal text-muted-foreground"
        tabIndex={hasDetails ? 0 : undefined}
      >
        <ActivityIcon className="text-emerald-600 dark:text-emerald-400" />
        Healthy
      </Badge>
    )
    if (!health || !hasDetails) return badge
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <HealthDetails health={health} />
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="destructive" className="cursor-help" tabIndex={0}>
          <SnowflakeIcon />
          Cooling down{health.cooldownLeft ? ` · ${health.cooldownLeft}` : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <HealthDetails health={health} />
      </TooltipContent>
    </Tooltip>
  )
}

function HealthDetails({ health }: { health: ModelHealthSummary }) {
  return (
    <div className="grid gap-1 text-left">
      <p className="font-medium">
        {health.consecutiveFailures} consecutive failure
        {health.consecutiveFailures === 1 ? "" : "s"}
        {health.lastStatus ? ` · last status ${health.lastStatus}` : ""}
      </p>
      {health.lastError && (
        <p className="line-clamp-6 break-words">{health.lastError}</p>
      )}
    </div>
  )
}

export function ModelEnabledSwitch({
  id,
  slug,
  enabled,
}: {
  id: string
  slug: string
  enabled: boolean
}) {
  const [optimistic, setOptimistic] = useOptimistic(enabled)
  const [pending, startTransition] = useTransition()

  return (
    <Switch
      checked={optimistic}
      disabled={pending}
      aria-label={`${optimistic ? "Disable" : "Enable"} ${slug}`}
      onCheckedChange={(checked) =>
        startTransition(async () => {
          setOptimistic(checked)
          const result = await setModelEnabled(id, checked)
          if (result.ok) toast.success(result.message)
          else toast.error(result.error)
        })
      }
    />
  )
}

function snippet(text: string | undefined, max = 160): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim()
  if (!clean) return "(empty response)"
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** Runs a one-shot test against a model and reports it as a toast. */
export function useModelTest() {
  const [pending, startTransition] = useTransition()

  function run(id: string, slug: string) {
    startTransition(async () => {
      const toastId = toast.loading(`Testing ${slug}…`)
      const result = await runModelTest(id)
      if (!result.ok) {
        toast.error(result.error, { id: toastId })
        return
      }
      const test = result.data
      if (!test) {
        toast.error("The test returned no result", { id: toastId })
        return
      }
      if (test.ok) {
        const tokens =
          test.inputTokens != null || test.outputTokens != null
            ? ` · ${test.inputTokens ?? 0} in / ${test.outputTokens ?? 0} out`
            : ""
        toast.success(
          `${slug} responded in ${formatMs(test.latencyMs)}${tokens}`,
          {
            id: toastId,
            description: snippet(test.output),
          }
        )
      } else {
        toast.error(
          `${slug} failed${test.status ? ` with ${test.status}` : ""} after ${formatMs(test.latencyMs)}`,
          {
            id: toastId,
            description: snippet(test.error ?? "No error details", 300),
          }
        )
      }
    })
  }

  return { pending, run }
}

export function TestModelButton({ id, slug }: { id: string; slug: string }) {
  const { pending, run } = useModelTest()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => run(id, slug)}
    >
      {pending ? <Spinner /> : <FlaskConicalIcon />}
      Test
    </Button>
  )
}

export function ModelRowActions({ model }: { model: ModelListItem }) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const test = useModelTest()

  function resetHealth() {
    startTransition(async () => {
      const result = await resetModelHealth(model.id)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteModel(model.id)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${model.slug}`}
            disabled={pending || test.pending}
          >
            {pending || test.pending ? <Spinner /> : <MoreHorizontalIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => test.run(model.id, model.slug)}>
            <FlaskConicalIcon />
            Test
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!model.health} onSelect={resetHealth}>
            <RotateCcwIcon />
            Reset health
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ModelFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        providerId={model.providerId}
        providerSlug={model.providerSlug}
        providerType={model.providerType}
        model={model}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {model.slug}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from every route that uses it, and clients calling
              it by slug start getting errors. Request logs are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={remove}
            >
              Delete model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
