"use client"

import { useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { SUGGESTED_TAGS } from "@/lib/providers/catalog"

import { normalizeTag } from "./shared"

/** Tags as removable chips, a free-form input, and one-click suggestions. */
export function TagInput({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  const suggestions = SUGGESTED_TAGS.filter((tag) => !value.includes(tag))

  function add(raw: string) {
    const tags = raw.split(",").map(normalizeTag).filter(Boolean)
    const next = [...value]
    for (const tag of tags) if (!next.includes(tag)) next.push(tag)
    if (next.length !== value.length) onChange(next)
    setDraft("")
  }

  function remove(tag: string) {
    onChange(value.filter((existing) => existing !== tag))
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="pr-1">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <InputGroup>
        <InputGroupInput
          id={id}
          value={draft}
          placeholder="Add a tag and press Enter"
          onChange={(event) => {
            const next = event.target.value
            if (next.endsWith(",")) add(next)
            else setDraft(next)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (draft.trim()) add(draft)
            } else if (event.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1])
            }
          }}
          onBlur={() => {
            if (draft.trim()) add(draft)
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton disabled={!draft.trim()} onClick={() => add(draft)}>
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {suggestions.map((tag) => (
            <Badge
              key={tag}
              asChild
              variant="outline"
              className="cursor-pointer hover:bg-muted"
            >
              <button type="button" onClick={() => add(tag)}>
                <PlusIcon />
                {tag}
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
