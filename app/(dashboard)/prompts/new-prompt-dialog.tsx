"use client"

import { useState, useTransition } from "react"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { PROMPT_SLUG_PATTERN } from "@/lib/prompt-template"

import { createPrompt } from "./actions"
import {
  MAX_DESCRIPTION_CHARS,
  MAX_NAME_CHARS,
  MAX_SLUG_CHARS,
  toPromptSlug,
} from "./shared"

export function NewPromptDialog({ label = "New prompt" }: { label?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState("")
  const [pending, startTransition] = useTransition()

  const slugInvalid = slug.length > 0 && !PROMPT_SLUG_PATTERN.test(slug)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName("")
      setSlug("")
      setSlugEdited(false)
      setDescription("")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createPrompt({ name, slug, description })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onOpenChange(false)
      if (result.data) router.push(`/prompts/${result.data.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>New prompt</DialogTitle>
            <DialogDescription>
              It starts with a short example you can change. Apps call it by its
              slug.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="prompt-name">Name</FieldLabel>
              <Input
                id="prompt-name"
                required
                autoFocus
                maxLength={MAX_NAME_CHARS}
                placeholder="Support reply"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugEdited) setSlug(toPromptSlug(event.target.value))
                }}
              />
            </Field>
            <Field data-invalid={slugInvalid || undefined}>
              <FieldLabel htmlFor="prompt-slug">Slug</FieldLabel>
              <Input
                id="prompt-slug"
                required
                maxLength={MAX_SLUG_CHARS}
                placeholder="support-reply"
                className="font-mono"
                aria-invalid={slugInvalid || undefined}
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(event.target.value.toLowerCase())
                }}
              />
              <FieldDescription>
                {slugInvalid
                  ? "Use lowercase letters, numbers, dots, dashes and underscores. Start with a letter or number."
                  : "Apps send this to use the prompt."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="prompt-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="prompt-description"
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
              {pending && <Spinner />}
              Create prompt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
