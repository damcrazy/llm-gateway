import type { Metadata } from "next"
import Link from "next/link"
import { CircleAlertIcon, ServerIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { requireMember } from "@/lib/auth"
import { hashInviteToken } from "@/lib/crypto"
import { formatRelative } from "@/lib/format"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { AcceptedNotice, AcceptInviteForm } from "./accept-invite-form"

export const metadata: Metadata = { title: "Shared provider" }

type Props = { params: Promise<{ token: string }> }

type InviteRow = {
  email: string | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  failed_attempts: number
}

/** Why this person can't accept the invite, or null if they can. */
function inviteProblem(
  invite: InviteRow | null,
  provider: { owner_email: string | null } | null,
  email: string
): { title: string; body: string } | null {
  if (!invite || !provider || provider.owner_email === null)
    return {
      title: "This invite doesn't exist",
      body: "Check that you copied the whole link.",
    }
  else if (invite.revoked_at)
    return {
      title: "This invite was cancelled",
      body: "Ask the person who sent it for a new one.",
    }
  else if (invite.accepted_at)
    return {
      title: "This invite has already been used",
      body: "Each invite works once. Ask for a new one if you need access.",
    }
  else if (new Date(invite.expires_at).getTime() <= Date.now())
    return {
      title: "This invite has expired",
      body: "Ask the person who sent it for a new one.",
    }
  else if (invite.failed_attempts >= 5)
    return {
      title: "This invite is locked",
      body: "The wrong code was entered too many times. Ask for a new invite.",
    }
  else if (provider.owner_email === email)
    return {
      title: "This is your own provider",
      body: "Send the link and code to the person you want to share it with.",
    }
  else if (invite.email && invite.email !== email)
    return {
      title: "This invite is for someone else",
      body: `It was made for a different email address than ${email}. Sign in with that account to accept it.`,
    }

  return null
}

async function hasShare(providerId: string, email: string) {
  const { data } = await supabaseAdmin()
    .from("provider_shares")
    .select("member_email")
    .eq("provider_id", providerId)
    .eq("member_email", email)
    .maybeSingle()
  return Boolean(data)
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" asChild>
          <Link href="/providers">Go to providers</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export default async function ShareInvitePage({ params }: Props) {
  const me = await requireMember()
  const { token } = await params
  const header = (
    <PageHeader
      title="Shared provider"
      description="Someone wants to let your apps use their AI provider."
    />
  )
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
    return (
      <>
        {header}
        <Problem
          title="This invite doesn't exist"
          body="Check that you copied the whole link."
        />
      </>
    )

  const db = supabaseAdmin()
  const { data: invite } = await db
    .from("provider_invites")
    .select(
      "provider_id, created_by, email, expires_at, accepted_at, accepted_by, revoked_at, failed_attempts, providers(name, slug, owner_email, enabled)"
    )
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle()
  const provider = invite?.providers as unknown as {
    name: string
    slug: string
    owner_email: string | null
    enabled: boolean
  } | null

  // Accepted by this person (say, the page was refreshed): show the result.
  if (invite?.accepted_by === me.email && provider)
    return (
      <>
        {header}
        <AcceptedNotice
          providerName={provider.name}
          providerSlug={provider.slug}
          owner={invite.created_by as string}
          stillShared={await hasShare(invite.provider_id as string, me.email)}
        />
      </>
    )

  const problem = inviteProblem(invite as InviteRow | null, provider, me.email)

  if (problem)
    return (
      <>
        {header}
        <Problem {...problem} />
      </>
    )

  const [{ data: existing }, { count: models }] = await Promise.all([
    db
      .from("provider_shares")
      .select("member_email")
      .eq("provider_id", invite!.provider_id as string)
      .eq("member_email", me.email)
      .maybeSingle(),
    db
      .from("models")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", invite!.provider_id as string)
      .eq("enabled", true),
  ])

  return (
    <>
      {header}
      <AcceptInviteForm
        token={token}
        providerName={provider!.name}
        providerSlug={provider!.slug}
        owner={invite!.created_by as string}
        models={models ?? 0}
        expires={formatRelative(invite!.expires_at as string)}
        alreadyShared={Boolean(existing)}
        icon={<ServerIcon />}
      />
    </>
  )
}
