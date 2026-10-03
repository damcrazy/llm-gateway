"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { KeyRoundIcon, Trash2Icon } from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import type { ProviderConfig } from "@/lib/db/types"
import { PROVIDER_TYPE_SPECS, type ProviderType } from "@/lib/providers/catalog"

import {
  deleteProvider,
  replaceProviderCredentials,
  updateProvider,
} from "../actions"
import type { FieldValues } from "../shared"
import { SpecFields } from "../spec-fields"

function configValues(type: ProviderType, config: ProviderConfig): FieldValues {
  const values: FieldValues = {}
  for (const field of PROVIDER_TYPE_SPECS[type].configFields) {
    const value = config[field.key as keyof ProviderConfig]
    values[field.key] = typeof value === "string" ? value : ""
  }
  return values
}

export function ProviderSettingsForm({
  id,
  name: initialName,
  slug,
  type,
  config,
  quota,
}: {
  id: string
  name: string
  slug: string
  type: ProviderType
  config: ProviderConfig
  /** Free-tier caps shared by all of this provider's models. */
  quota: { rpm: number | null; rpd: number | null }
}) {
  const uid = useId()
  const spec = PROVIDER_TYPE_SPECS[type]
  const [saved, setSaved] = useState(() => ({
    name: initialName,
    config: configValues(type, config),
    rpm: quota.rpm == null ? "" : String(quota.rpm),
    rpd: quota.rpd == null ? "" : String(quota.rpd),
  }))
  const [name, setName] = useState(saved.name)
  const [values, setValues] = useState<FieldValues>(saved.config)
  const [rpm, setRpm] = useState(saved.rpm)
  const [rpd, setRpd] = useState(saved.rpd)
  const [pending, startTransition] = useTransition()

  const dirty =
    name !== saved.name ||
    rpm !== saved.rpm ||
    rpd !== saved.rpd ||
    spec.configFields.some(
      (field) => (values[field.key] ?? "") !== (saved.config[field.key] ?? "")
    )

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateProvider(id, {
        name,
        config: values,
        quotaRpm: rpm.trim() ? Number(rpm) : null,
        quotaRpd: rpd.trim() ? Number(rpd) : null,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setSaved({ name, config: values, rpm, rpd })
      toast.success(result.message)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
          <Input
            id={`${uid}-name`}
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-slug`}>Slug</FieldLabel>
          <Input
            id={`${uid}-slug`}
            value={slug}
            readOnly
            disabled
            className="font-mono"
          />
          <FieldDescription>
            Part of every model slug; can&apos;t be changed.
          </FieldDescription>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${uid}-type`}>Type</FieldLabel>
        <Input id={`${uid}-type`} value={spec.label} readOnly disabled />
      </Field>
      <SpecFields
        idPrefix={`${uid}-config`}
        fields={spec.configFields}
        values={values}
        onChange={(key, value) =>
          setValues((current) => ({ ...current, [key]: value }))
        }
      />
      <FieldSet className="gap-3" data-tour="provider-quota">
        <FieldLegend variant="label" className="mb-0">
          Free-tier limits for the whole provider
        </FieldLegend>
        <FieldDescription>
          For caps that apply to your key across all of its models (e.g.
          OpenRouter free: 20 a minute, 50 a day). Per-model caps are set on
          each model. Days reset at 00:00 UTC. Leave blank for no limit.
        </FieldDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${uid}-quota-rpm`}>Per minute</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${uid}-quota-rpm`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="No limit"
                value={rpm}
                onChange={(event) => setRpm(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>requests</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-quota-rpd`}>Per day</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${uid}-quota-rpd`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="No limit"
                value={rpd}
                onChange={(event) => setRpd(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>requests</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
      </FieldSet>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty}>
          {pending && <Spinner />}
          Save changes
        </Button>
      </div>
    </form>
  )
}

export function ReplaceCredentialsDialog({
  id,
  type,
  hint,
}: {
  id: string
  type: ProviderType
  hint: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRoundIcon />
          Replace credentials
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <ReplaceCredentialsForm
          id={id}
          type={type}
          hint={hint}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ReplaceCredentialsForm({
  id,
  type,
  hint,
  onDone,
}: {
  id: string
  type: ProviderType
  hint: string | null
  onDone: () => void
}) {
  const uid = useId()
  const spec = PROVIDER_TYPE_SPECS[type]
  const [values, setValues] = useState<FieldValues>({})
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await replaceProviderCredentials(id, values)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Replace credentials</DialogTitle>
        <DialogDescription>
          {hint ? (
            <>
              Currently using{" "}
              <code className="font-mono text-foreground">{hint}</code>.{" "}
            </>
          ) : null}
          Everything below replaces all stored credentials; fields left empty
          are cleared.
        </DialogDescription>
      </DialogHeader>
      <SpecFields
        idPrefix={`${uid}-credentials`}
        fields={spec.credentialFields}
        values={values}
        onChange={(key, value) =>
          setValues((current) => ({ ...current, [key]: value }))
        }
        secret
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Replace credentials
        </Button>
      </DialogFooter>
    </form>
  )
}

export function DeleteProviderButton({
  id,
  name,
  modelCount,
}: {
  id: string
  name: string
  modelCount: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {modelCount > 0
              ? `Its ${modelCount} model${modelCount === 1 ? " is" : "s are"} deleted too and removed from every route. `
              : ""}
            The stored credentials are destroyed. Request logs are kept. This
            can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await deleteProvider(id)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success(result.message)
                router.push("/providers")
              })
            }
          >
            Delete provider
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
