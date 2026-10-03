"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { BracesIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import { AREAS, type AuditArea } from "./shared"

const ALL = "__all"

export function AuditFilters({
  area,
  actor,
  actors,
  showActor,
}: {
  area: AuditArea | null
  actor: string
  actors: string[]
  showActor: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function update(patch: { area?: string; actor?: string }) {
    const next = new URLSearchParams()
    const nextArea = patch.area ?? area ?? ""
    const nextActor = patch.actor ?? actor
    if (nextArea) next.set("area", nextArea)
    if (nextActor) next.set("actor", nextActor)
    startTransition(() =>
      router.push(`/audit${next.size ? `?${next}` : ""}`, { scroll: false })
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={area ?? ALL}
        onValueChange={(value) => update({ area: value === ALL ? "" : value })}
      >
        <SelectTrigger
          data-tour="audit-area"
          aria-label="Area"
          className="w-full sm:w-48"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL}>Everything</SelectItem>
          {AREAS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showActor && (
        <Select
          value={actor || ALL}
          onValueChange={(value) =>
            update({ actor: value === ALL ? "" : value })
          }
        >
          <SelectTrigger
            data-tour="audit-person"
            aria-label="Person"
            className="w-full sm:w-64"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value={ALL}>Everyone</SelectItem>
            {actor && !actors.includes(actor) && (
              <SelectItem value={actor}>{actor}</SelectItem>
            )}
            {actors.map((email) => (
              <SelectItem key={email} value={email}>
                {email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {pending && <Spinner className="text-muted-foreground" />}
    </div>
  )
}

export function AuditDetails({
  details,
}: {
  details: Record<string, unknown>
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <BracesIcon />
          Details
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {JSON.stringify(details, null, 2)}
        </pre>
      </PopoverContent>
    </Popover>
  )
}
