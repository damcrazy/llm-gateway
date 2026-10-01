"use client"

import { useMemo, useState, useTransition } from "react"
import { SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
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
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  ModelMultiSelect,
  type ModelOptions,
} from "@/components/model-multi-select"
import type { AppRow } from "@/lib/db/types"

import { updateAppSettings } from "../actions"

const NO_DEFAULT = "__none"

export type { ModelOptions }

type SettingsApp = Pick<
  AppRow,
  | "id"
  | "name"
  | "description"
  | "allowed_models"
  | "default_model"
  | "monthly_budget_usd"
  | "rpm_limit"
  | "log_payloads"
>

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : Number(trimmed)
}

export function AppSettingsForm({
  app,
  options,
}: {
  app: SettingsApp
  options: ModelOptions
}) {
  const [name, setName] = useState(app.name)
  const [description, setDescription] = useState(app.description ?? "")
  const [allowed, setAllowed] = useState<string[]>(app.allowed_models ?? [])
  const [defaultModel, setDefaultModel] = useState(app.default_model ?? "")
  const [budget, setBudget] = useState(
    app.monthly_budget_usd == null ? "" : String(Number(app.monthly_budget_usd))
  )
  const [rpm, setRpm] = useState(
    app.rpm_limit == null ? "" : String(app.rpm_limit)
  )
  const [logPayloads, setLogPayloads] = useState(app.log_payloads)
  const [pending, startTransition] = useTransition()

  // Default model choices: the allow-list when one is set, else everything.
  const defaultChoices = useMemo(() => {
    if (allowed.length > 0) {
      return {
        routes: allowed.filter((v) => options.routes.includes(v)),
        models: allowed.filter((v) => !options.routes.includes(v)),
      }
    }
    return options
  }, [allowed, options])
  const defaultIsListed =
    !defaultModel ||
    defaultChoices.routes.includes(defaultModel) ||
    defaultChoices.models.includes(defaultModel)
  const defaultOutsideAllowList =
    !!defaultModel && allowed.length > 0 && !allowed.includes(defaultModel)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateAppSettings(app.id, {
        name,
        description,
        allowedModels: allowed,
        defaultModel: defaultModel || null,
        monthlyBudgetUsd: parseOptionalNumber(budget),
        rpmLimit: parseOptionalNumber(rpm),
        logPayloads,
      })
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Limits and defaults applied to every request made with this
            app&apos;s keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                <Input
                  id="settings-name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-description">
                  Description
                </FieldLabel>
                <Textarea
                  id="settings-description"
                  rows={1}
                  maxLength={500}
                  className="min-h-9"
                  placeholder="What is this app for?"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </div>

            <FieldSeparator />

            <Field>
              <FieldLabel htmlFor="settings-allowed">Allowed models</FieldLabel>
              <ModelMultiSelect
                id="settings-allowed"
                options={options}
                value={allowed}
                onChange={setAllowed}
              />
              <FieldDescription>
                Routes or model slugs this app may call. Leave empty to allow
                everything.
              </FieldDescription>
            </Field>

            <Field data-invalid={defaultOutsideAllowList || undefined}>
              <FieldLabel htmlFor="settings-default">Default model</FieldLabel>
              <Select
                value={defaultModel || NO_DEFAULT}
                onValueChange={(value) =>
                  setDefaultModel(value === NO_DEFAULT ? "" : value)
                }
              >
                <SelectTrigger
                  id="settings-default"
                  className="w-full md:w-80"
                  aria-invalid={defaultOutsideAllowList || undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-80">
                  <SelectItem value={NO_DEFAULT}>No default</SelectItem>
                  {!defaultIsListed && (
                    <SelectItem value={defaultModel}>{defaultModel}</SelectItem>
                  )}
                  {defaultChoices.routes.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Routes</SelectLabel>
                        {defaultChoices.routes.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  {defaultChoices.models.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Models</SelectLabel>
                        {defaultChoices.models.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
              <FieldDescription>
                {defaultOutsideAllowList
                  ? "This model is not in the allowed list. Pick another or allow it."
                  : 'Used when a client sends no model, or the model "default".'}
              </FieldDescription>
            </Field>

            <div className="grid gap-6 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="settings-budget">
                  Monthly budget
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="settings-budget"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="No limit"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>USD</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Requests are rejected once this calendar month&apos;s spend
                  reaches it.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-rpm">Rate limit</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="settings-rpm"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="No limit"
                    value={rpm}
                    onChange={(event) => setRpm(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>requests / min</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Shared by all of this app&apos;s keys.
                </FieldDescription>
              </Field>
            </div>

            <FieldSeparator />

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="settings-log-payloads">
                  Log full payloads
                </FieldLabel>
                <FieldDescription>
                  Store prompts and responses for each request so you can
                  inspect them in Logs. Payloads are kept for 7 days.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-log-payloads"
                checked={logPayloads}
                onCheckedChange={setLogPayloads}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? <Spinner /> : <SaveIcon />}
            Save settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
