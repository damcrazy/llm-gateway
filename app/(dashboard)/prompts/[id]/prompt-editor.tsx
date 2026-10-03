"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FlaskConicalIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

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
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
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
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, formatRelative } from "@/lib/format"
import {
  PROMPT_SLUG_PATTERN,
  promptVariables,
  type PromptMessage,
  type PromptRole,
} from "@/lib/prompt-template"

import {
  deletePrompt,
  savePromptVersion,
  setPublishedVersion,
  updatePromptInfo,
} from "../actions"
import {
  curlSnippet,
  KEY_PLACEHOLDER,
  MAX_DESCRIPTION_CHARS,
  MAX_MAX_TOKENS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_MODEL_CHARS,
  MAX_NAME_CHARS,
  MAX_NOTE_CHARS,
  MAX_SLUG_CHARS,
  MAX_TEMPERATURE,
  pythonSnippet,
  ROLES,
  type PromptInfo,
  type PromptVersion,
} from "../shared"

// ---------------------------------------------------------------------------
// Draft: the messages and defaults being edited (a copy of a version).
// ---------------------------------------------------------------------------

interface DraftMessage extends PromptMessage {
  /** Stable React key while messages are added, removed and reordered. */
  key: string
}

interface Draft {
  messages: DraftMessage[]
  model: string
  temperature: string
  maxTokens: string
}

let keySeq = 0
/** Only call from event handlers, never while rendering. */
function newKey() {
  keySeq += 1
  return `m${keySeq}`
}

function toDraft(
  version: PromptVersion | undefined,
  keyFor: (index: number) => string
): Draft {
  if (!version) {
    return {
      messages: [{ key: keyFor(0), role: "user", content: "" }],
      model: "",
      temperature: "",
      maxTokens: "",
    }
  }
  return {
    messages: version.messages.map((message, index) => ({
      key: keyFor(index),
      role: message.role,
      content: message.content,
    })),
    model: version.model ?? "",
    temperature:
      version.params.temperature == null
        ? ""
        : String(version.params.temperature),
    maxTokens:
      version.params.max_tokens == null
        ? ""
        : String(version.params.max_tokens),
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  const plain = (draft: Draft) =>
    JSON.stringify([
      draft.messages.map((m) => [m.role, m.content]),
      draft.model.trim(),
      draft.temperature.trim(),
      draft.maxTokens.trim(),
    ])
  return plain(a) === plain(b)
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : Number(trimmed)
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function PromptEditor({
  prompt,
  versions,
  origin,
  viewerEmail,
  viewerIsAdmin,
}: {
  prompt: PromptInfo
  /** Newest first. */
  versions: PromptVersion[]
  origin: string
  viewerEmail: string
  viewerIsAdmin: boolean
}) {
  const latest = versions[0]?.version ?? 0
  const [selected, setSelected] = useState<number | null>(
    versions[0]?.version ?? null
  )
  const [base, setBase] = useState(() =>
    toDraft(versions[0], (index) => `init-${index}`)
  )
  const [draft, setDraft] = useState(base)
  const [note, setNote] = useState("")
  const [confirmOpen, setConfirmOpen] = useState<number | null>(null)
  const [saving, startSaving] = useTransition()

  const dirty = !sameDraft(draft, base)
  const variables = promptVariables(draft.messages)
  const temperature = parseOptionalNumber(draft.temperature)
  const temperatureInvalid =
    temperature !== null &&
    (!Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > MAX_TEMPERATURE)
  const maxTokens = parseOptionalNumber(draft.maxTokens)
  const maxTokensInvalid =
    maxTokens !== null &&
    (!Number.isInteger(maxTokens) ||
      maxTokens < 1 ||
      maxTokens > MAX_MAX_TOKENS)
  const nextVersion = latest + 1
  const unchanged = !dirty && selected === latest && latest > 0
  const ownerLabel =
    prompt.owner_email === viewerEmail ? "you" : prompt.owner_email

  function openVersion(version: number) {
    const row = versions.find((v) => v.version === version)
    if (!row) return
    const next = toDraft(row, () => newKey())
    setSelected(version)
    setBase(next)
    setDraft(next)
    setConfirmOpen(null)
  }

  function requestOpen(version: number) {
    if (dirty) setConfirmOpen(version)
    else openVersion(version)
  }

  function updateMessage(key: string, patch: Partial<PromptMessage>) {
    setDraft((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.key === key ? { ...message, ...patch } : message
      ),
    }))
  }

  function moveMessage(index: number, delta: -1 | 1) {
    setDraft((current) => {
      const target = index + delta
      if (target < 0 || target >= current.messages.length) return current
      const messages = [...current.messages]
      ;[messages[index], messages[target]] = [
        messages[target]!,
        messages[index]!,
      ]
      return { ...current, messages }
    })
  }

  function removeMessage(key: string) {
    setDraft((current) => ({
      ...current,
      messages: current.messages.filter((message) => message.key !== key),
    }))
  }

  function addMessage(role: PromptRole) {
    const key = newKey()
    setDraft((current) =>
      current.messages.length >= MAX_MESSAGES
        ? current
        : {
            ...current,
            messages: [...current.messages, { key, role, content: "" }],
          }
    )
  }

  function save(event: React.FormEvent) {
    event.preventDefault()
    const snapshot = draft
    startSaving(async () => {
      const result = await savePromptVersion(prompt.id, {
        messages: snapshot.messages.map(({ role, content }) => ({
          role,
          content,
        })),
        model: snapshot.model,
        temperature: parseOptionalNumber(snapshot.temperature),
        maxTokens: parseOptionalNumber(snapshot.maxTokens),
        note,
      })
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "The version was not saved" : result.error)
        return
      }
      toast.success(result.message)
      setSelected(result.data.version)
      setBase(snapshot)
      setNote("")
    })
  }

  const selectedLabel = selected ? `version ${selected}` : "a blank prompt"

  return (
    <>
      <PageHeader
        className="-mt-3"
        title={prompt.name}
        description={
          <>
            <span className="font-mono">{prompt.slug}</span>
            {prompt.description && <> · {prompt.description}</>}
            {viewerIsAdmin && <> · Owner: {ownerLabel}</>}
          </>
        }
        actions={
          <>
            <EditDetailsDialog prompt={prompt} />
            <Button variant="outline" asChild>
              <Link
                href={
                  selected
                    ? `/compare?prompt=${prompt.id}&version=${selected}`
                    : `/compare?prompt=${prompt.id}`
                }
                title={
                  dirty && selected
                    ? `Uses saved version ${selected}, without your changes`
                    : undefined
                }
              >
                <FlaskConicalIcon />
                Try in Compare
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="grid min-w-0 gap-6">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>
                {dirty
                  ? `Changed from ${selectedLabel}. Save to keep your changes.`
                  : `Showing ${selectedLabel}. Apps get these messages first, then their own.`}
              </CardDescription>
              {dirty && (
                <CardAction>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft(base)}
                  >
                    <Undo2Icon />
                    Discard
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="grid min-w-0 gap-3">
              {draft.messages.map((message, index) => (
                <MessageRow
                  key={message.key}
                  message={message}
                  index={index}
                  count={draft.messages.length}
                  onChange={(patch) => updateMessage(message.key, patch)}
                  onMove={(delta) => moveMessage(index, delta)}
                  onRemove={() => removeMessage(message.key)}
                />
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={draft.messages.length >= MAX_MESSAGES}
                    >
                      <PlusIcon />
                      Add message
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    {ROLES.map((role) => (
                      <DropdownMenuItem
                        key={role.value}
                        onSelect={() => addMessage(role.value)}
                      >
                        {role.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {draft.messages.length} of {MAX_MESSAGES} messages
                </span>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-start gap-2 border-t">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="mr-1 text-muted-foreground">Variables:</span>
                {variables.length ? (
                  variables.map((name) => (
                    <Badge key={name} variant="secondary" className="font-mono">
                      {name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">none</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Use{" "}
                <code className="font-mono text-foreground">{"{{name}}"}</code>{" "}
                for values your app fills in.
              </p>
            </CardFooter>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Defaults</CardTitle>
              <CardDescription>
                Used when the request doesn&apos;t set them. All optional.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-6 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="prompt-model">Default model</FieldLabel>
                  <Input
                    id="prompt-model"
                    maxLength={MAX_MODEL_CHARS}
                    placeholder="None"
                    className="font-mono"
                    value={draft.model}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    A bucket, route or model slug, used when the request names
                    no model.
                  </FieldDescription>
                </Field>
                <Field data-invalid={temperatureInvalid || undefined}>
                  <FieldLabel htmlFor="prompt-temperature">
                    Temperature
                  </FieldLabel>
                  <Input
                    id="prompt-temperature"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={MAX_TEMPERATURE}
                    step={0.1}
                    placeholder="Model default"
                    aria-invalid={temperatureInvalid || undefined}
                    value={draft.temperature}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        temperature: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    0 to {MAX_TEMPERATURE}. Lower gives steadier answers.
                  </FieldDescription>
                </Field>
                <Field data-invalid={maxTokensInvalid || undefined}>
                  <FieldLabel htmlFor="prompt-max-tokens">
                    Max tokens
                  </FieldLabel>
                  <Input
                    id="prompt-max-tokens"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_MAX_TOKENS}
                    step={1}
                    placeholder="Model default"
                    aria-invalid={maxTokensInvalid || undefined}
                    value={draft.maxTokens}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        maxTokens: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>
                    The longest answer, in tokens.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <form onSubmit={save}>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Save as version {nextVersion}</CardTitle>
                <CardDescription>
                  {unchanged
                    ? "No changes yet. Edit the messages or defaults above first."
                    : `${
                        !dirty && selected
                          ? `Saves version ${selected} again as the newest. `
                          : ""
                      }Saved versions never change. ${
                        prompt.published_version == null
                          ? "Apps get the newest version, so they use it right away."
                          : `Apps keep getting version ${prompt.published_version} until you publish the new one.`
                      }`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field>
                  <FieldLabel htmlFor="prompt-note">
                    Note{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FieldLabel>
                  <Input
                    id="prompt-note"
                    maxLength={MAX_NOTE_CHARS}
                    placeholder="What changed?"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
              </CardContent>
              <CardFooter className="justify-end border-t">
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    unchanged ||
                    temperatureInvalid ||
                    maxTokensInvalid
                  }
                >
                  {saving ? <Spinner /> : <SaveIcon />}
                  Save as version {nextVersion}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </div>

        <div className="grid min-w-0 gap-6">
          <VersionsCard
            promptId={prompt.id}
            versions={versions}
            published={prompt.published_version}
            selected={selected}
            onOpen={requestOpen}
          />
          <UsageCard
            prompt={prompt}
            versions={versions}
            selected={selected}
            origin={origin}
            ownerLabel={ownerLabel}
          />
          <Card className="ring-destructive/40">
            <CardHeader>
              <CardTitle>Delete this prompt</CardTitle>
              <CardDescription>
                Deletes all {versions.length} version
                {versions.length === 1 ? "" : "s"}. Apps that use{" "}
                <span className="font-mono">{prompt.slug}</span> start getting
                errors. Request logs are kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeletePromptButton id={prompt.id} name={prompt.name} />
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={confirmOpen !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open version {confirmOpen}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmOpen !== null) openVersion(confirmOpen)
              }}
            >
              Discard and open
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// One message: role, text, and move/remove buttons.
// ---------------------------------------------------------------------------

function MessageRow({
  message,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  message: DraftMessage
  index: number
  count: number
  onChange: (patch: Partial<PromptMessage>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const number = index + 1
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Select
          value={message.role}
          onValueChange={(value) => onChange({ role: value as PromptRole })}
        >
          <SelectTrigger
            size="sm"
            className="w-32"
            aria-label={`Role of message ${number}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {ROLES.map((role) => (
              <SelectItem key={role.value} value={role.value}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            aria-label={`Move message ${number} up`}
            title="Move up"
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            aria-label={`Move message ${number} down`}
            title="Move down"
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={count === 1}
            aria-label={`Remove message ${number}`}
            title="Remove"
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      <Textarea
        rows={3}
        maxLength={MAX_MESSAGE_CHARS}
        aria-label={`Message ${number}`}
        placeholder={
          message.role === "system"
            ? "How the model should behave"
            : message.role === "user"
              ? "What the user says, e.g. {{question}}"
              : "An example answer"
        }
        className="max-h-[60vh] min-h-20"
        value={message.content}
        onChange={(event) => onChange({ content: event.target.value })}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Versions: open one, publish one, or follow the latest.
// ---------------------------------------------------------------------------

function VersionsCard({
  promptId,
  versions,
  published,
  selected,
  onOpen,
}: {
  promptId: string
  versions: PromptVersion[]
  published: number | null
  selected: number | null
  onOpen: (version: number) => void
}) {
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<number | "latest" | null>(null)
  const latest = versions[0]?.version ?? 0

  function publish(version: number | null) {
    setTarget(version ?? "latest")
    startTransition(async () => {
      const result = await setPublishedVersion(promptId, version)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      setTarget(null)
    })
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>
          {published == null
            ? `Apps get the newest version (now ${latest}) unless they ask for another. Publish one to pin it.`
            : `Apps get version ${published} unless they ask for another.`}
        </CardDescription>
        {published != null && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              title="Apps always get the newest version"
              onClick={() => publish(null)}
            >
              {pending && target === "latest" && <Spinner />}
              Use latest
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No versions yet. Save one to start.
          </p>
        ) : (
          <ItemGroup className="max-h-[32rem] gap-2 overflow-y-auto">
            {versions.map((version) => {
              const isPublished = version.version === published
              const isLatest = published == null && version.version === latest
              const isOpen = version.version === selected
              return (
                <Item
                  key={version.id}
                  variant={isOpen ? "muted" : "outline"}
                  size="sm"
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      Version {version.version}
                      {isPublished && <Badge>Published</Badge>}
                      {isLatest && <Badge variant="outline">Latest</Badge>}
                      {isOpen && <Badge variant="secondary">Open</Badge>}
                    </ItemTitle>
                    <ItemDescription className="break-words">
                      {version.note ?? "No note"}
                    </ItemDescription>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={formatDateTime(version.created_at)}
                    >
                      {version.created_by ? `${version.created_by} · ` : ""}
                      {formatRelative(version.created_at)}
                    </p>
                  </ItemContent>
                  <ItemActions>
                    {!isOpen && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpen(version.version)}
                      >
                        Open
                      </Button>
                    )}
                    {!isPublished && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => publish(version.version)}
                      >
                        {pending && target === version.version && <Spinner />}
                        Publish
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// "Use it": copy-paste snippets for calling the prompt.
// ---------------------------------------------------------------------------

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-4">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {title}
        </span>
        <CopyButton
          content={code}
          variant="ghost"
          size="xs"
          aria-label={`Copy ${title}`}
          onCopiedChange={(copied) => {
            if (copied) toast.success("Copied")
          }}
        />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function UsageCard({
  prompt,
  versions,
  selected,
  origin,
  ownerLabel,
}: {
  prompt: PromptInfo
  versions: PromptVersion[]
  selected: number | null
  origin: string
  ownerLabel: string
}) {
  const [pinned, setPinned] = useState(false)
  const pin = pinned && selected !== null ? selected : null
  // The version the request would get: the pinned one, else the published
  // one, else the newest.
  const served =
    versions.find(
      (v) => v.version === (pin ?? prompt.published_version ?? undefined)
    ) ?? versions[0]
  const input = {
    origin,
    slug: prompt.slug,
    version: pin,
    variables: served ? promptVariables(served.messages) : [],
    hasModel: Boolean(served?.model),
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Use it</CardTitle>
        <CardDescription>
          Call it with a key from an app owned by {ownerLabel}. Replace{" "}
          <code className="font-mono">{KEY_PLACEHOLDER}</code> and the{" "}
          <code className="font-mono">{"<values>"}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {selected !== null && (
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="prompt-pin">
                Ask for version {selected}
              </FieldLabel>
              <FieldDescription>
                Off: apps get the published version, or the newest when none is
                published.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="prompt-pin"
              checked={pinned}
              onCheckedChange={setPinned}
            />
          </Field>
        )}
        <Tabs defaultValue="curl" className="min-w-0 gap-4">
          <TabsList>
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="python">Python</TabsTrigger>
          </TabsList>
          <TabsContents className="-m-1 p-1">
            <TabsContent value="curl" className="min-w-0">
              <CodeBlock title="curl" code={curlSnippet(input)} />
            </TabsContent>
            <TabsContent value="python" className="min-w-0">
              <CodeBlock
                title="pip install openai"
                code={pythonSnippet(input)}
              />
            </TabsContent>
          </TabsContents>
        </Tabs>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            The prompt&apos;s messages come first, then any{" "}
            <code className="font-mono">messages</code> you send.
          </li>
          <li>
            {input.hasModel
              ? "model is optional: the version's default model is used."
              : "This version has no default model, so name one in the request."}
          </li>
          <li>Leaving out a variable gets a 400 error that lists it.</li>
          <li>
            The same <code className="font-mono">prompt</code> field works on{" "}
            <code className="font-mono">/v1/responses</code> and{" "}
            <code className="font-mono">/v1/messages</code>.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Details (name, slug, description) and delete.
// ---------------------------------------------------------------------------

function EditDetailsDialog({ prompt }: { prompt: PromptInfo }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(prompt.name)
  const [slug, setSlug] = useState(prompt.slug)
  const [description, setDescription] = useState(prompt.description ?? "")
  const [pending, startTransition] = useTransition()

  const slugInvalid = slug.length > 0 && !PROMPT_SLUG_PATTERN.test(slug)
  const slugChanged = slug !== prompt.slug

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setName(prompt.name)
      setSlug(prompt.slug)
      setDescription(prompt.description ?? "")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updatePromptInfo(prompt.id, {
        name,
        slug,
        description,
      })
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
        <Button variant="outline">
          <PencilIcon />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>
              The name and description are only shown here. Apps use the slug.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="details-name">Name</FieldLabel>
              <Input
                id="details-name"
                required
                maxLength={MAX_NAME_CHARS}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field data-invalid={slugInvalid || undefined}>
              <FieldLabel htmlFor="details-slug">Slug</FieldLabel>
              <Input
                id="details-slug"
                required
                maxLength={MAX_SLUG_CHARS}
                className="font-mono"
                aria-invalid={slugInvalid || undefined}
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
              />
              <FieldDescription>
                {slugInvalid
                  ? "Use lowercase letters, numbers, dots, dashes and underscores. Start with a letter or number."
                  : slugChanged
                    ? `Apps that still send "${prompt.slug}" will get errors.`
                    : "Apps send this to use the prompt."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="details-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="details-description"
                rows={3}
                maxLength={MAX_DESCRIPTION_CHARS}
                placeholder="What is this prompt for?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || !name.trim() || !slug || slugInvalid}
            >
              {pending ? <Spinner /> : <SaveIcon />}
              Save details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeletePromptButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending}>
          {pending ? <Spinner /> : <Trash2Icon />}
          Delete prompt
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The prompt and all of its versions are deleted, and apps that use it
            start getting errors. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await deletePrompt(id)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success(result.message)
                router.replace("/prompts")
              })
            }
          >
            Delete prompt
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
