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
import { slugify } from "@/lib/actions"

import { SLUG_PATTERN } from "./_lib"
import { createApp } from "./actions"

export function NewAppDialog({ label = "New app" }: { label?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState("")
  const [pending, startTransition] = useTransition()

  const slugInvalid = slug.length > 0 && !SLUG_PATTERN.test(slug)

  function reset() {
    setName("")
    setSlug("")
    setSlugEdited(false)
    setDescription("")
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createApp({ name, slug, description })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
      reset()
      if (result.data) router.push(`/apps/${result.data.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>New app</DialogTitle>
            <DialogDescription>
              Register a project that calls the gateway. You can create API keys
              for it next.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="app-name">Name</FieldLabel>
              <Input
                id="app-name"
                required
                autoFocus
                maxLength={80}
                placeholder="Recipe bot"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugEdited) setSlug(slugify(event.target.value))
                }}
              />
            </Field>
            <Field data-invalid={slugInvalid || undefined}>
              <FieldLabel htmlFor="app-slug">Slug</FieldLabel>
              <Input
                id="app-slug"
                required
                maxLength={48}
                placeholder="recipe-bot"
                className="font-mono"
                aria-invalid={slugInvalid || undefined}
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(event.target.value.toLowerCase())
                }}
              />
              <FieldDescription>
                Lowercase letters, numbers and dashes. Shown in logs.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="app-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="app-description"
                rows={3}
                maxLength={500}
                placeholder="What is this app for?"
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
              Create app
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
