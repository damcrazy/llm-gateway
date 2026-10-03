"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/animate-ui/components/radix/radio-group"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { RouteStrategy } from "@/lib/db/types"

import { updateRouteSettings } from "../actions"
import { STRATEGY_OPTIONS } from "../shared"

export interface RouteSettingsValues {
  description: string
  strategy: RouteStrategy
  /** Numeric fields are kept as the raw input strings. */
  maxAttempts: string
  timeoutSeconds: string
  firstTokenTimeoutSeconds: string
  enabled: boolean
}

function sameValues(a: RouteSettingsValues, b: RouteSettingsValues) {
  return (
    a.description === b.description &&
    a.strategy === b.strategy &&
    a.maxAttempts === b.maxAttempts &&
    a.timeoutSeconds === b.timeoutSeconds &&
    a.firstTokenTimeoutSeconds === b.firstTokenTimeoutSeconds &&
    a.enabled === b.enabled
  )
}

function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value)
}

export function RouteSettingsForm({
  routeId,
  initial,
}: {
  routeId: string
  initial: RouteSettingsValues
}) {
  const [values, setValues] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [pending, startTransition] = useTransition()
  const dirty = !sameValues(values, saved)

  function update<K extends keyof RouteSettingsValues>(
    key: K,
    value: RouteSettingsValues[K]
  ) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const maxAttempts = parseNumber(values.maxAttempts)
    const timeoutSeconds = parseNumber(values.timeoutSeconds)
    const firstTokenTimeoutSeconds = parseNumber(
      values.firstTokenTimeoutSeconds
    )
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      toast.error("Max attempts must be a whole number between 1 and 10")
      return
    }
    if (!(timeoutSeconds >= 1 && timeoutSeconds <= 3600)) {
      toast.error("Timeout must be between 1 and 3600 seconds")
      return
    }
    if (!(firstTokenTimeoutSeconds >= 1 && firstTokenTimeoutSeconds <= 3600)) {
      toast.error("First-token timeout must be between 1 and 3600 seconds")
      return
    }

    const submitted = values
    startTransition(async () => {
      const result = await updateRouteSettings(routeId, {
        description: submitted.description,
        strategy: submitted.strategy,
        maxAttempts,
        timeoutSeconds,
        firstTokenTimeoutSeconds,
        enabled: submitted.enabled,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setSaved(submitted)
      toast.success(result.message)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>
          How the gateway walks the targets for each request.
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit} className="contents">
        <CardContent>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="route-description">Description</FieldLabel>
              <Textarea
                id="route-description"
                maxLength={500}
                placeholder="What this route is for"
                value={values.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>

            <Field data-tour="route-strategy">
              <FieldTitle>Strategy</FieldTitle>
              <RadioGroup
                value={values.strategy}
                onValueChange={(value) =>
                  update("strategy", value as RouteStrategy)
                }
                className="gap-2"
              >
                {STRATEGY_OPTIONS.map((option) => (
                  <FieldLabel
                    key={option.value}
                    htmlFor={`strategy-${option.value}`}
                    className="has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
                  >
                    <Field orientation="horizontal">
                      <RadioGroupItem
                        value={option.value}
                        id={`strategy-${option.value}`}
                      />
                      <FieldContent>
                        <FieldTitle>{option.label}</FieldTitle>
                        <FieldDescription className="text-xs">
                          {option.description}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </Field>

            <div data-tour="route-limits" className="grid gap-5">
              <Field>
                <FieldLabel htmlFor="route-max-attempts">
                  Max attempts
                </FieldLabel>
                <Input
                  id="route-max-attempts"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  step={1}
                  required
                  value={values.maxAttempts}
                  onChange={(event) =>
                    update("maxAttempts", event.target.value)
                  }
                />
                <FieldDescription>
                  How many targets to try per request before giving up (1–10).
                </FieldDescription>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                <Field>
                  <FieldLabel htmlFor="route-timeout">
                    Timeout (seconds)
                  </FieldLabel>
                  <Input
                    id="route-timeout"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={3600}
                    step="any"
                    required
                    value={values.timeoutSeconds}
                    onChange={(event) =>
                      update("timeoutSeconds", event.target.value)
                    }
                  />
                  <FieldDescription>
                    Longest an upstream call may run before it&apos;s aborted.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="route-first-token-timeout">
                    First-token timeout (seconds)
                  </FieldLabel>
                  <Input
                    id="route-first-token-timeout"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={3600}
                    step="any"
                    required
                    value={values.firstTokenTimeoutSeconds}
                    onChange={(event) =>
                      update("firstTokenTimeoutSeconds", event.target.value)
                    }
                  />
                  <FieldDescription>
                    How long to wait for a stream to start before failing over
                    to the next target.
                  </FieldDescription>
                </Field>
              </div>
            </div>

            <Field orientation="horizontal">
              <Switch
                id="route-enabled"
                checked={values.enabled}
                onCheckedChange={(checked) => update("enabled", checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor="route-enabled">Enabled</FieldLabel>
                <FieldDescription>
                  Disabled routes reject every request.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setValues(saved)}
            >
              Discard
            </Button>
          )}
          <Button type="submit" disabled={pending || !dirty}>
            {pending && <Spinner />}
            Save settings
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
