"use client"

import { useState } from "react"
import { ChevronsUpDownIcon, XIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export interface ModelOptions {
  routes: string[]
  models: string[]
}

/** Multi-select of route names and model slugs (empty = all). */
export function ModelMultiSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "All routes and models",
}: {
  id: string
  options: ModelOptions
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const known = new Set([...options.routes, ...options.models])
  const unknown = value.filter((v) => !known.has(v))

  function toggle(item: string) {
    onChange(
      value.includes(item) ? value.filter((v) => v !== item) : [...value, item]
    )
  }

  const groups: { heading: string; items: string[] }[] = [
    { heading: "Routes", items: options.routes },
    { heading: "Models", items: options.models },
    { heading: "Unavailable", items: unknown },
  ]

  return (
    <div className="grid gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal md:w-80"
          >
            <span className={value.length ? "" : "text-muted-foreground"}>
              {value.length ? `${value.length} selected` : placeholder}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        >
          <Command>
            <CommandInput placeholder="Search routes and models…" />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map(
                (group) =>
                  group.items.length > 0 && (
                    <CommandGroup key={group.heading} heading={group.heading}>
                      {group.items.map((item) => (
                        <CommandItem
                          key={item}
                          value={item}
                          data-checked={value.includes(item)}
                          onSelect={() => toggle(item)}
                        >
                          <span className="truncate font-mono text-xs">
                            {item}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Badge
              key={item}
              variant={known.has(item) ? "secondary" : "outline"}
              className="gap-1 pr-1 font-mono"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={() => toggle(item)}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-5 px-1 text-xs"
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}
