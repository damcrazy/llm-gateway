import type { Metadata } from "next"
import Link from "next/link"
import { MessageSquareTextIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireMember } from "@/lib/auth"
import { formatDateTime, formatRelative } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"
import { getTimeZone } from "@/lib/time-zone-server"

import { NewPromptDialog } from "./new-prompt-dialog"
import { PROMPT_COLUMNS, type PromptInfo } from "./shared"

export const metadata: Metadata = { title: "Prompts" }

type PromptListRow = PromptInfo & { prompt_versions: { version: number }[] }

export default async function PromptsPage() {
  const me = await requireMember()
  const timeZone = await getTimeZone()

  // RLS: admins read every prompt, members only their own.
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("prompts")
    .select(`${PROMPT_COLUMNS}, prompt_versions(version)`)
    .order("updated_at", { ascending: false })
  const prompts = (data ?? []) as unknown as PromptListRow[]
  const showOwner =
    me.isAdmin && prompts.some((prompt) => prompt.owner_email !== me.email)

  return (
    <>
      <PageTour id="prompts" />
      <PageHeader
        title="Prompts"
        description="Saved prompts with versions. Apps call them by slug and fill in the blanks, so you can change the wording without changing code."
        actions={prompts.length > 0 && <NewPromptDialog />}
      />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load prompts</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {prompts.length === 0 ? (
        <Empty data-tour="prompts-empty" className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareTextIcon />
            </EmptyMedia>
            <EmptyTitle>No prompts yet</EmptyTitle>
            <EmptyDescription>
              A prompt is a set of messages with blanks like{" "}
              <code className="font-mono text-xs">{"{{name}}"}</code>. Your apps
              send its slug and the values, and the gateway puts the messages in
              front of theirs. Every save is a new version, and you choose which
              one apps get.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewPromptDialog label="Create your first prompt" />
          </EmptyContent>
        </Empty>
      ) : (
        <Card data-tour="prompts-table" className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Slug</TableHead>
                  {showOwner && <TableHead>Owner</TableHead>}
                  <TableHead className="text-right">Latest version</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="pr-6">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prompts.map((prompt, index) => {
                  const latest = Math.max(
                    0,
                    ...prompt.prompt_versions.map((v) => v.version)
                  )
                  return (
                    <TableRow key={prompt.id}>
                      <TableCell
                        data-tour={index === 0 ? "prompts-name" : undefined}
                        className="max-w-72 pl-6 font-medium"
                      >
                        <Link
                          href={`/prompts/${prompt.id}`}
                          className="block truncate hover:underline"
                        >
                          {prompt.name}
                        </Link>
                        {prompt.description && (
                          <p className="truncate text-xs font-normal text-muted-foreground">
                            {prompt.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell
                        data-tour={index === 0 ? "prompts-slug" : undefined}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {prompt.slug}
                      </TableCell>
                      {showOwner && (
                        <TableCell className="max-w-56 truncate text-muted-foreground">
                          {prompt.owner_email === me.email
                            ? "You"
                            : prompt.owner_email}
                        </TableCell>
                      )}
                      <TableCell
                        data-tour={index === 0 ? "prompts-latest" : undefined}
                        className="text-right tabular-nums"
                      >
                        {latest ? `v${latest}` : "—"}
                      </TableCell>
                      <TableCell
                        data-tour={
                          index === 0 ? "prompts-published" : undefined
                        }
                      >
                        {prompt.published_version == null ? (
                          <Badge variant="outline">Latest</Badge>
                        ) : (
                          <Badge variant="secondary">
                            v{prompt.published_version}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="pr-6 whitespace-nowrap text-muted-foreground"
                        title={formatDateTime(prompt.updated_at, timeZone)}
                      >
                        {formatRelative(prompt.updated_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}
