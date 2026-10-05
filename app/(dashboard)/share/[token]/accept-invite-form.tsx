"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { CircleCheckIcon, KeyRoundIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { OtpCodeInput } from "@/components/otp-code-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"

import { acceptProviderInvite } from "../../providers/sharing-actions"

export function AcceptInviteForm({
  token,
  providerName,
  providerSlug,
  owner,
  models,
  expires,
  alreadyShared,
  icon,
}: {
  token: string
  providerName: string
  providerSlug: string
  owner: string
  models: number
  expires: string
  alreadyShared: boolean
  icon: React.ReactNode
}) {
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [pending, startTransition] = useTransition()

  function accept(value = code) {
    if (value.length !== 6 || pending) return
    setError(null)
    startTransition(async () => {
      const result = await acceptProviderInvite(token, value)
      if (result.ok) setAccepted(true)
      else {
        setError(result.error)
        setCode("")
      }
    })
  }

  if (accepted)
    return (
      <AcceptedNotice
        providerName={providerName}
        providerSlug={providerSlug}
        owner={owner}
        stillShared
      />
    )

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:text-muted-foreground">
          {icon}
          {providerName}
        </CardTitle>
        <CardDescription>
          {owner} wants to share this provider with you ({models} model
          {models === 1 ? "" : "s"}). The invite expires {expires}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Your apps can use its models; {owner}&apos;s key pays for them.
          </li>
          <li>
            You won&apos;t see their key or settings, and you can&apos;t share
            it with anyone else.
          </li>
          <li>
            {owner} can take access back at any time, and you can leave it
            whenever you like.
          </li>
        </ul>
        {alreadyShared && (
          <Alert>
            <CircleCheckIcon />
            <AlertTitle>You already have access</AlertTitle>
            <AlertDescription>
              Accepting again changes nothing, but uses up this invite.
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="invite-code">6-digit code</FieldLabel>
          <OtpCodeInput
            id="invite-code"
            value={code}
            onChange={(value) => {
              setCode(value)
              setError(null)
            }}
            onComplete={(value) => accept(value)}
            disabled={pending}
            autoFocus
          />
          <FieldDescription>
            {owner} sent it to you separately from the link.
          </FieldDescription>
        </Field>
        {error && (
          <Alert variant="destructive">
            <KeyRoundIcon />
            <AlertTitle>Couldn&apos;t accept</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button
          disabled={code.length !== 6 || pending}
          onClick={() => accept()}
        >
          {pending && <Spinner />}
          Accept
        </Button>
      </CardFooter>
    </Card>
  )
}

export function AcceptedNotice({
  providerName,
  providerSlug,
  owner,
  stillShared,
}: {
  providerName: string
  providerSlug: string
  owner: string
  stillShared: boolean
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleCheckIcon />
        </EmptyMedia>
        <EmptyTitle>
          {stillShared
            ? `${providerName} is now available to your apps`
            : `You accepted this invite earlier`}
        </EmptyTitle>
        <EmptyDescription>
          {stillShared ? (
            <>
              Its models show up in Models, in your apps&apos; buckets and in
              the Playground, under the slug <code>{providerSlug}/…</code>. They
              can take a few seconds to appear.
            </>
          ) : (
            `You no longer have access to ${providerName}. Ask ${owner} for a new invite if you need it again.`
          )}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button asChild>
          <Link href={stillShared ? "/models" : "/providers"}>
            {stillShared ? "See its models" : "Go to providers"}
          </Link>
        </Button>
        {stillShared && (
          <Button variant="outline" asChild>
            <Link href="/providers">Providers</Link>
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}
