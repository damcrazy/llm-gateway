"use client"

import { useState, useTransition } from "react"
import { GaugeIcon, SaveIcon } from "lucide-react"
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
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

import type { KeyLimits } from "../_lib"
import { updateApiKeyLimits } from "../actions"

export interface KeyLimitValues {
  rpm: string
  tpm: string
  budget: string
}

export function limitValues(limits: KeyLimits): KeyLimitValues {
  return {
    rpm: limits.rpmLimit == null ? "" : String(limits.rpmLimit),
    tpm: limits.tpmLimit == null ? "" : String(limits.tpmLimit),
    budget:
      limits.monthlyBudgetUsd == null ? "" : String(limits.monthlyBudgetUsd),
  }
}

export function parseLimitValues(values: KeyLimitValues): KeyLimits {
  const parse = (value: string) => (value.trim() ? Number(value) : null)
  return {
    rpmLimit: parse(values.rpm),
    tpmLimit: parse(values.tpm),
    monthlyBudgetUsd: parse(values.budget),
  }
}

/** Requests, tokens and budget for one key, on top of the app's limits. */
export function KeyLimitFields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string
  values: KeyLimitValues
  onChange: (values: KeyLimitValues) => void
}) {
  const field = (
    key: keyof KeyLimitValues,
    label: string,
    unit: string,
    decimal = false
  ) => (
    <Field>
      <FieldLabel htmlFor={`${idPrefix}-${key}`}>{label}</FieldLabel>
      <InputGroup>
        {decimal && (
          <InputGroupAddon>
            <InputGroupText>$</InputGroupText>
          </InputGroupAddon>
        )}
        <InputGroupInput
          id={`${idPrefix}-${key}`}
          type="number"
          inputMode={decimal ? "decimal" : "numeric"}
          min={decimal ? 0 : 1}
          step={decimal ? "0.01" : 1}
          placeholder="App limit"
          value={values[key]}
          onChange={(event) =>
            onChange({ ...values, [key]: event.target.value })
          }
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )

  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label" className="mb-0">
        Limits for this key
      </FieldLegend>
      <FieldDescription>
        Optional, on top of the app&apos;s own limits. Useful for giving a
        teammate or a script a smaller allowance.
      </FieldDescription>
      <div className="grid gap-3 sm:grid-cols-3">
        {field("rpm", "Requests", "/ min")}
        {field("tpm", "Tokens", "/ min")}
        {field("budget", "Budget", "/ month", true)}
      </div>
    </FieldSet>
  )
}

export function KeyLimitsDialog({
  appId,
  keyId,
  name,
  limits,
}: {
  appId: string
  keyId: string
  name: string
  limits: KeyLimits
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState(() => limitValues(limits))
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) setValues(limitValues(limits))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateApiKeyLimits(
        appId,
        keyId,
        parseLimitValues(values)
      )
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Limits for ${name}`}>
          <GaugeIcon />
          Limits
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Limits for {name}</DialogTitle>
            <DialogDescription>
              Leave a field empty to only apply the app&apos;s limit. Changes
              reach the gateway within 30 seconds.
            </DialogDescription>
          </DialogHeader>
          <KeyLimitFields
            idPrefix={`limits-${keyId}`}
            values={values}
            onChange={setValues}
          />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : <SaveIcon />}
              Save limits
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
