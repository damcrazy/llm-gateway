"use client"

import { useId, useState, useTransition } from "react"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import type { ModelKind } from "@/lib/db/types"
import {
  isMediaKind,
  MODEL_KIND_LABELS,
  MODEL_KINDS,
  UNIT_PRICE_LABELS,
} from "@/lib/model-kinds"
import type { DiscoveredModel } from "@/lib/gateway/discovery"
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
  type ProviderType,
} from "@/lib/providers/catalog"

import { createModel, suggestMetadata, updateModel } from "./actions"
import type { ModelFieldsInput, ModelListItem } from "./shared"
import { TagInput } from "./tag-input"

interface FormState {
  modelId: string
  displayName: string
  kind: ModelKind
  capabilities: Capability[]
  tags: string[]
  contextWindow: string
  maxOutputTokens: string
  inputPrice: string
  outputPrice: string
  cachedInputPrice: string
  unitPrice: string
  quotaRpm: string
  quotaRpd: string
}

function toText(value: number | null | undefined): string {
  return value == null ? "" : String(value)
}

function initialState(model?: ModelListItem): FormState {
  return {
    modelId: model?.modelId ?? "",
    displayName: model?.displayName ?? "",
    kind: model?.kind ?? "chat",
    capabilities: model?.capabilities ?? [],
    tags: model?.tags ?? [],
    contextWindow: toText(model?.contextWindow),
    maxOutputTokens: toText(model?.maxOutputTokens),
    inputPrice: toText(model?.inputPrice),
    outputPrice: toText(model?.outputPrice),
    cachedInputPrice: toText(model?.cachedInputPrice),
    unitPrice: toText(model?.unitPrice),
    quotaRpm: toText(model?.quotaRpm),
    quotaRpd: toText(model?.quotaRpd),
  }
}

function applySuggestion(
  state: FormState,
  suggestion: DiscoveredModel
): FormState {
  return {
    ...state,
    displayName: state.displayName || suggestion.display_name || "",
    kind: suggestion.kind,
    capabilities: suggestion.capabilities,
    contextWindow: toText(suggestion.context_window),
    maxOutputTokens: toText(suggestion.max_output_tokens),
    inputPrice: toText(suggestion.input_price_per_mtok),
    outputPrice: toText(suggestion.output_price_per_mtok),
    cachedInputPrice: toText(suggestion.cached_input_price_per_mtok),
  }
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : Number(trimmed)
}

function toFields(state: FormState): ModelFieldsInput {
  return {
    display_name: state.displayName.trim() || null,
    kind: state.kind,
    capabilities: state.capabilities,
    tags: state.tags,
    context_window: optionalNumber(state.contextWindow),
    max_output_tokens: optionalNumber(state.maxOutputTokens),
    input_price_per_mtok: optionalNumber(state.inputPrice),
    output_price_per_mtok: optionalNumber(state.outputPrice),
    cached_input_price_per_mtok: optionalNumber(state.cachedInputPrice),
    unit_price_usd: isMediaKind(state.kind)
      ? optionalNumber(state.unitPrice)
      : null,
    quota_rpm: optionalNumber(state.quotaRpm),
    quota_rpd: optionalNumber(state.quotaRpd),
  }
}

export function modelIdHelp(type: ProviderType): string {
  switch (type) {
    case "azure_openai":
      return "The Azure deployment name, not the underlying model name."
    case "bedrock":
      return "A Bedrock model id or an inference profile id, e.g. us.anthropic.claude-…"
    case "vertex":
      return "A Vertex model id, e.g. gemini-… Ids starting with claude- use the Anthropic endpoint."
    default:
      return "Exactly as the provider's API expects it."
  }
}

export interface ModelFormDialogProps {
  providerId: string
  providerSlug: string
  providerType: ProviderType
  /** Edit this model; omit to add a new one. */
  model?: ModelListItem
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ModelFormDialog({
  trigger,
  open,
  onOpenChange,
  ...props
}: ModelFormDialogProps) {
  const [innerOpen, setInnerOpen] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = onOpenChange ?? setInnerOpen

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so every open starts from fresh values. */}
        <ModelForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ModelForm({
  providerId,
  providerSlug,
  providerType,
  model,
  onDone,
}: Omit<ModelFormDialogProps, "trigger" | "open" | "onOpenChange"> & {
  onDone: () => void
}) {
  const uid = useId()
  const isEdit = Boolean(model)
  const [state, setState] = useState<FormState>(() => initialState(model))
  const [saving, startSaving] = useTransition()
  const [prefilling, startPrefill] = useTransition()

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  function toggleCapability(capability: Capability, checked: boolean) {
    setState((current) => ({
      ...current,
      capabilities: checked
        ? CAPABILITIES.filter(
            (c) => c === capability || current.capabilities.includes(c)
          )
        : current.capabilities.filter((c) => c !== capability),
    }))
  }

  function prefill() {
    const modelId = state.modelId.trim()
    if (!modelId) {
      toast.error("Enter a model id first")
      return
    }
    startPrefill(async () => {
      const result = await suggestMetadata(providerId, modelId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (!result.data) {
        toast.info(`No catalogue entry for ${modelId}`, {
          description: "Fill in capabilities and prices manually.",
        })
        return
      }
      const suggestion = result.data
      setState((current) => applySuggestion(current, suggestion))
      toast.success("Prefilled from the catalogue", {
        description: "Check the values before saving.",
      })
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const fields = toFields(state)
    startSaving(async () => {
      const result = model
        ? await updateModel(model.id, fields)
        : await createModel(providerId, { ...fields, model_id: state.modelId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onDone()
    })
  }

  const slugPreview = `${providerSlug}/${state.modelId.trim() || "model-id"}`

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${model?.slug}` : "Add model"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Capabilities decide which requests this model can serve; prices drive cost tracking."
            : "Add a model this provider serves. Clients can call it directly by its slug."}
        </DialogDescription>
      </DialogHeader>

      {isEdit ? (
        <Field>
          <FieldLabel>Model id</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-2 font-mono text-sm">
              {model?.modelId}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={prefill}
              disabled={prefilling}
            >
              {prefilling ? <Spinner /> : <SparklesIcon />}
              Refresh from catalogue
            </Button>
          </div>
        </Field>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${uid}-model-id`}>
            Model id <span className="text-destructive">*</span>
          </FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`${uid}-model-id`}
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={state.modelId}
              onChange={(event) => set("modelId", event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={prefill}
              disabled={prefilling || !state.modelId.trim()}
            >
              {prefilling ? <Spinner /> : <SparklesIcon />}
              Prefill from catalogue
            </Button>
          </div>
          <FieldDescription>
            {modelIdHelp(providerType)} Slug:{" "}
            <code className="font-mono text-foreground">{slugPreview}</code>
          </FieldDescription>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${uid}-display-name`}>Display name</FieldLabel>
          <Input
            id={`${uid}-display-name`}
            placeholder="Optional"
            value={state.displayName}
            onChange={(event) => set("displayName", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-kind`}>Kind</FieldLabel>
          <Select
            value={state.kind}
            onValueChange={(value) => set("kind", value as ModelKind)}
          >
            <SelectTrigger id={`${uid}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {MODEL_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <FieldSet className="gap-3">
        <FieldLegend variant="label" className="mb-0">
          Capabilities
        </FieldLegend>
        <FieldDescription>
          The router skips this model for requests that need a capability it
          lacks.
        </FieldDescription>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <Field key={capability} orientation="horizontal">
              <Checkbox
                id={`${uid}-cap-${capability}`}
                size="sm"
                checked={state.capabilities.includes(capability)}
                onCheckedChange={(checked) =>
                  toggleCapability(capability, checked === true)
                }
              />
              <FieldLabel
                htmlFor={`${uid}-cap-${capability}`}
                className="font-normal"
              >
                {CAPABILITY_LABELS[capability]}
              </FieldLabel>
            </Field>
          ))}
        </div>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={`${uid}-tags`}>Tags</FieldLabel>
        <TagInput
          id={`${uid}-tags`}
          value={state.tags}
          onChange={(tags) => set("tags", tags)}
        />
        <FieldDescription>
          Free-form categories for filtering, like fast, cheap or coding.
        </FieldDescription>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${uid}-context`}>Context window</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${uid}-context`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="e.g. 128000"
              value={state.contextWindow}
              onChange={(event) => set("contextWindow", event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>tokens</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-max-output`}>
            Max output tokens
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${uid}-max-output`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="e.g. 16384"
              value={state.maxOutputTokens}
              onChange={(event) => set("maxOutputTokens", event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>tokens</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </div>

      <FieldSet className="gap-3">
        <FieldLegend variant="label" className="mb-0">
          Prices
        </FieldLegend>
        <FieldDescription>
          {isMediaKind(state.kind)
            ? `USD ${UNIT_PRICE_LABELS[state.kind]}, used to compute request costs. Token prices are optional, for models that bill by the token (like gpt-image-1).`
            : "USD per 1M tokens, used to compute request costs. Enter 0 for free models; leave blank if you don't know the price."}
        </FieldDescription>
        {isMediaKind(state.kind) && (
          <div className="grid gap-4 sm:grid-cols-3">
            <PriceField
              id={`${uid}-price-unit`}
              label={`Price ${UNIT_PRICE_LABELS[state.kind]}`}
              placeholder="Unknown"
              value={state.unitPrice}
              onChange={(value) => set("unitPrice", value)}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <PriceField
            id={`${uid}-price-in`}
            label="Input"
            placeholder="Unknown"
            value={state.inputPrice}
            onChange={(value) => set("inputPrice", value)}
          />
          <PriceField
            id={`${uid}-price-out`}
            label="Output"
            placeholder="Unknown"
            value={state.outputPrice}
            onChange={(value) => set("outputPrice", value)}
          />
          <PriceField
            id={`${uid}-price-cached`}
            label="Cached input"
            placeholder="Optional"
            value={state.cachedInputPrice}
            onChange={(value) => set("cachedInputPrice", value)}
          />
        </div>
      </FieldSet>

      <FieldSet className="gap-3">
        <FieldLegend variant="label" className="mb-0">
          Free-tier limits
        </FieldLegend>
        <FieldDescription>
          The provider&apos;s caps for this model, if any (e.g. Gemini free: 15
          a minute, 1,500 a day). Once reached, buckets skip it instead of
          getting a 429. Days reset at 00:00 UTC. Leave blank for no limit.
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
                value={state.quotaRpm}
                onChange={(event) => set("quotaRpm", event.target.value)}
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
                value={state.quotaRpd}
                onChange={(event) => set("quotaRpd", event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>requests</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
      </FieldSet>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          {isEdit ? "Save changes" : "Add model"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function PriceField({
  id,
  label,
  value,
  placeholder = "0",
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
    </Field>
  )
}
