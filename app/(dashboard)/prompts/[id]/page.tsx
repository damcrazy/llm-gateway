import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { getOrigin, requireMember } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  isPromptId,
  PROMPT_COLUMNS,
  VERSION_COLUMNS,
  type PromptInfo,
  type PromptVersion,
} from "../shared"
import { PromptEditor } from "./prompt-editor"

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  if (!isPromptId(id)) return { title: "Prompt" }
  const supabase = await createClient()
  const { data } = await supabase
    .from("prompts")
    .select("name")
    .eq("id", id)
    .maybeSingle()
  return { title: (data?.name as string | undefined) ?? "Prompt" }
}

export default async function PromptPage({ params }: Props) {
  const me = await requireMember()
  const { id } = await params
  if (!isPromptId(id)) notFound()

  // RLS: admins read every prompt, members only their own.
  const supabase = await createClient()
  const [promptResult, versionsResult, origin] = await Promise.all([
    supabase.from("prompts").select(PROMPT_COLUMNS).eq("id", id).maybeSingle(),
    supabase
      .from("prompt_versions")
      .select(VERSION_COLUMNS)
      .eq("prompt_id", id)
      .order("version", { ascending: false }),
    getOrigin(),
  ])
  if (promptResult.error) throw new Error(promptResult.error.message)
  const prompt = promptResult.data as PromptInfo | null
  if (!prompt) notFound()
  if (versionsResult.error) throw new Error(versionsResult.error.message)
  const versions = ((versionsResult.data ?? []) as PromptVersion[]).map(
    (version) => ({ ...version, params: version.params ?? {} })
  )

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/prompts">Prompts</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{prompt.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <PromptEditor
        prompt={prompt}
        versions={versions}
        origin={origin}
        viewerEmail={me.email}
        viewerIsAdmin={me.isAdmin}
      />
    </>
  )
}
