"use client"

import { useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { ModelKind, RouteStrategy } from "@/lib/db/types"

import { createRoute, setRouteEnabled } from "./actions"
import { KIND_LABELS, routeNameError, STRATEGY_OPTIONS } from "./shared"

export function NewRouteDialog({
  variant = "default",
}: {
  variant?: "default" | "outline"
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [kind, setKind] = useState<ModelKind>("chat")
  const [strategy, setStrategy] = useState<RouteStrategy>("fallback")
  const [touched, setTouched] = useState(false)
  const [pending, startTransition] = useTransition()

  const nameProblem = routeNameError(name)
  const showNameProblem = touched && nameProblem !== null
  const strategyHelp = STRATEGY_OPTIONS.find(
    (option) => option.value === strategy
  )?.description

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (nameProblem) return
    startTransition(async () => {
      const result = await createRoute({ name, description, kind, strategy })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
      setName("")
      setDescription("")
      setTouched(false)
      if (result.data) router.push(`/routes/${result.data.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <PlusIcon />
          New route
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New route</DialogTitle>
            <DialogDescription>
              A named alias with an ordered list of models. You&apos;ll pick the
              models next.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={showNameProblem || undefined}>
            <FieldLabel htmlFor="route-name">Name</FieldLabel>
            <Input
              id="route-name"
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="smart"
              className="font-mono"
              aria-invalid={showNameProblem || undefined}
              value={name}
              onChange={(event) =>
                setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))
              }
              onBlur={() => name && setTouched(true)}
            />
            {showNameProblem ? (
              <FieldError>{nameProblem}</FieldError>
            ) : (
              <FieldDescription>
                Apps send this as <code className="font-mono">model</code>, e.g.{" "}
                <code className="font-mono">
                  &quot;model&quot;: &quot;{name || "smart"}&quot;
                </code>
                .
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="route-description">Description</FieldLabel>
            <Textarea
              id="route-description"
              placeholder="Best available model for hard problems"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="route-kind">Kind</FieldLabel>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as ModelKind)}
              >
                <SelectTrigger id="route-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as ModelKind[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="route-strategy">Strategy</FieldLabel>
              <Select
                value={strategy}
                onValueChange={(value) => setStrategy(value as RouteStrategy)}
              >
                <SelectTrigger id="route-strategy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {strategyHelp && <FieldDescription>{strategyHelp}</FieldDescription>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create route
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RouteEnabledSwitch({
  id,
  name,
  enabled,
}: {
  id: string
  name: string
  enabled: boolean
}) {
  const [optimistic, setOptimistic] = useOptimistic(enabled)
  const [pending, startTransition] = useTransition()

  return (
    <Switch
      checked={optimistic}
      disabled={pending}
      aria-label={`${optimistic ? "Disable" : "Enable"} ${name}`}
      onCheckedChange={(value) =>
        startTransition(async () => {
          setOptimistic(value)
          const result = await setRouteEnabled(id, value)
          if (result.ok) toast.success(result.message)
          else toast.error(result.error)
        })
      }
    />
  )
}
