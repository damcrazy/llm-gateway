"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PlusIcon,
} from "lucide-react"
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
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { slugify } from "@/lib/actions"
import {
  PROVIDER_PRESETS,
  PROVIDER_TYPE_SPECS,
  type ProviderPreset,
} from "@/lib/providers/catalog"

import { createProvider } from "./actions"
import { hostOf, SLUG_HELP, SLUG_PATTERN, type FieldValues } from "./shared"
import { SpecFields } from "./spec-fields"

/**
 * `own`: a member adding their own provider. Only their apps can use it, it
 * must use a public https address, and its slug starts with `slugPrefix`
 * (slugs are shared by everyone on the gateway).
 */
export function AddProviderDialog({
  variant = "default",
  own = false,
  slugPrefix = "",
}: {
  variant?: "default" | "outline"
  own?: boolean
  slugPrefix?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} data-tour="providers-add">
          <PlusIcon />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so each open starts at step one. */}
        <AddProviderFlow
          own={own}
          slugPrefix={slugPrefix}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function AddProviderFlow({
  own,
  slugPrefix,
  onDone,
}: {
  own: boolean
  slugPrefix: string
  onDone: () => void
}) {
  const [preset, setPreset] = useState<ProviderPreset | null>(null)
  return preset ? (
    <ProviderForm
      preset={preset}
      slugPrefix={own ? slugPrefix : ""}
      onBack={() => setPreset(null)}
      onDone={onDone}
    />
  ) : (
    <PresetPicker own={own} onPick={setPreset} />
  )
}

const COMPATIBLE_PRESETS = PROVIDER_PRESETS.filter(
  (p) => p.type === "openai_compatible"
)
const NATIVE_PRESETS = PROVIDER_PRESETS.filter(
  (p) => p.type !== "openai_compatible"
)

/** Presets that only work on the gateway's own machine (e.g. Ollama). */
const isLocalPreset = (preset: ProviderPreset) =>
  Boolean(preset.baseUrl?.startsWith("http://"))

function PresetPicker({
  own,
  onPick,
}: {
  own: boolean
  onPick: (preset: ProviderPreset) => void
}) {
  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>
          {own ? "Add your own provider" : "Add provider"}
        </DialogTitle>
        <DialogDescription>
          {own
            ? "Use your own API key. Only your apps can use this provider's models, and it must use a public https:// address."
            : "Choose where the models live. Anything that speaks the OpenAI API can be added as Custom."}
        </DialogDescription>
      </DialogHeader>
      <PresetGroup
        title="OpenAI-compatible"
        description="Same adapter, different base URL. Models can be discovered automatically."
        presets={
          own
            ? COMPATIBLE_PRESETS.filter((preset) => !isLocalPreset(preset))
            : COMPATIBLE_PRESETS
        }
        describe={(preset) =>
          hostOf(preset.baseUrl) ?? "Any OpenAI-compatible base URL"
        }
        onPick={onPick}
      />
      <PresetGroup
        title="Native APIs"
        description="Dedicated adapters for providers with their own API or auth."
        presets={NATIVE_PRESETS}
        describe={(preset) => PROVIDER_TYPE_SPECS[preset.type].description}
        onPick={onPick}
      />
    </div>
  )
}

function PresetGroup({
  title,
  description,
  presets,
  describe,
  onPick,
}: {
  title: string
  description: string
  presets: ProviderPreset[]
  describe: (preset: ProviderPreset) => string
  onPick: (preset: ProviderPreset) => void
}) {
  return (
    <section className="grid gap-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((preset) => (
          <Item key={preset.id} asChild variant="outline" size="sm">
            <button
              type="button"
              onClick={() => onPick(preset)}
              className="flex-nowrap text-left hover:bg-muted"
            >
              <ItemContent className="min-w-0">
                <ItemTitle>{preset.label}</ItemTitle>
                <ItemDescription className="line-clamp-1 text-xs">
                  {describe(preset)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </ItemActions>
            </button>
          </Item>
        ))}
      </div>
    </section>
  )
}

function ProviderForm({
  preset,
  slugPrefix,
  onBack,
  onDone,
}: {
  preset: ProviderPreset
  slugPrefix: string
  onBack: () => void
  onDone: () => void
}) {
  const uid = useId()
  const router = useRouter()
  const spec = PROVIDER_TYPE_SPECS[preset.type]
  // "Ollama (local)" -> "Ollama": the qualifier is noise in names and slugs.
  const defaultName =
    preset.label.replace(/\s*\([^)]*\)/g, "").trim() || preset.label
  const [name, setName] = useState(defaultName)
  const slugFor = (value: string) =>
    slugify(slugPrefix ? `${slugPrefix}-${value}` : value)
  const [slug, setSlug] = useState(() => slugFor(defaultName))
  const [slugTouched, setSlugTouched] = useState(false)
  const [config, setConfig] = useState<FieldValues>(() => {
    const initial: FieldValues = {}
    if (preset.baseUrl) initial.baseUrl = preset.baseUrl
    return initial
  })
  const [credentials, setCredentials] = useState<FieldValues>({})
  const [pending, startTransition] = useTransition()

  const slugInvalid = slug !== "" && !SLUG_PATTERN.test(slug)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createProvider({
        presetId: preset.id,
        name,
        slug,
        config,
        credentials,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onDone()
      if (result.data) router.push(`/providers/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-2"
            onClick={onBack}
            aria-label="Back to presets"
          >
            <ArrowLeftIcon />
          </Button>
          <DialogTitle>Add {preset.label}</DialogTitle>
        </div>
        <DialogDescription>{spec.description}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${uid}-name`}>
            Name
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </FieldLabel>
          <Input
            id={`${uid}-name`}
            required
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugTouched) setSlug(slugFor(event.target.value))
            }}
          />
        </Field>
        <Field data-invalid={slugInvalid || undefined}>
          <FieldLabel htmlFor={`${uid}-slug`}>
            Slug
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </FieldLabel>
          <Input
            id={`${uid}-slug`}
            required
            maxLength={48}
            pattern="[a-z0-9][a-z0-9\-]*"
            title={SLUG_HELP}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            aria-invalid={slugInvalid || undefined}
            value={slug}
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(event.target.value.toLowerCase())
            }}
          />
          {slugInvalid && <FieldError>{SLUG_HELP}</FieldError>}
        </Field>
      </div>
      <FieldDescription className="-mt-2">
        The slug prefixes every model id, e.g.{" "}
        <code className="font-mono text-foreground">
          {slug || "slug"}/model-name
        </code>
        , so it can&apos;t be changed later.
      </FieldDescription>

      {spec.configFields.length > 0 && (
        <FieldSet className="gap-4">
          <FieldLegend variant="label" className="mb-0">
            Connection
          </FieldLegend>
          <SpecFields
            idPrefix={`${uid}-config`}
            fields={spec.configFields}
            values={config}
            onChange={(key, value) =>
              setConfig((current) => ({ ...current, [key]: value }))
            }
          />
        </FieldSet>
      )}

      {spec.credentialFields.length > 0 && (
        <FieldSet className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLegend variant="label" className="mb-0">
              Credentials
            </FieldLegend>
            {preset.keysUrl && (
              <Button variant="link" size="sm" className="h-auto p-0" asChild>
                <a href={preset.keysUrl} target="_blank" rel="noreferrer">
                  Get an API key
                  <ExternalLinkIcon />
                </a>
              </Button>
            )}
          </div>
          <FieldDescription className="-mt-2">
            Encrypted before storage and never shown again.
          </FieldDescription>
          <SpecFields
            idPrefix={`${uid}-credentials`}
            fields={spec.credentialFields}
            values={credentials}
            onChange={(key, value) =>
              setCredentials((current) => ({ ...current, [key]: value }))
            }
            secret
          />
        </FieldSet>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={pending || slugInvalid}>
          {pending && <Spinner />}
          Add provider
        </Button>
      </DialogFooter>
    </form>
  )
}
