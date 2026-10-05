"use client"

import { useState, useTransition } from "react"
import {
  LinkIcon,
  MailIcon,
  ShieldAlertIcon,
  UserPlusIcon,
  UsersIcon,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
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
import {
  formatDateTime,
  formatNumber,
  formatRelative,
  formatUsd,
} from "@/lib/format"

import {
  cancelProviderInvite,
  createProviderInvite,
  revokeProviderShare,
} from "../sharing-actions"
import { INVITE_DAYS, type InviteView, type ShareView } from "../sharing-shared"

export function SharingCard({
  providerId,
  providerName,
  shares,
  invites,
}: {
  providerId: string
  providerName: string
  shares: ShareView[]
  invites: InviteView[]
}) {
  return (
    <Card data-tour="provider-sharing">
      <CardHeader>
        <CardTitle>Sharing</CardTitle>
        <CardDescription>
          Let someone else&apos;s apps use this provider. Your key pays for what
          they use. They never see your key or settings, can&apos;t share it
          with anyone else, and you can take access back at any time.
        </CardDescription>
        <CardAction>
          <InviteDialog providerId={providerId} providerName={providerName} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        {shares.length === 0 && invites.length === 0 ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>Not shared with anyone</EmptyTitle>
              <EmptyDescription>
                Create an invite: you get a link and a 6-digit code to send to
                the other person.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {shares.length > 0 && (
          <div className="grid gap-2" data-tour="provider-sharing-people">
            <h3 className="text-sm font-medium">People with access</h3>
            <ItemGroup className="gap-2">
              {shares.map((share) => (
                <Item key={share.email} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <UsersIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate">{share.email}</ItemTitle>
                    <ItemDescription>
                      Since {formatDateTime(share.since)} · this month{" "}
                      {formatNumber(share.requests)} request
                      {share.requests === 1 ? "" : "s"},{" "}
                      {formatUsd(share.costUsd)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <RevokeButton
                      providerId={providerId}
                      providerName={providerName}
                      email={share.email}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </div>
        )}

        {invites.length > 0 && (
          <div className="grid gap-2" data-tour="provider-sharing-invites">
            <h3 className="text-sm font-medium">Open invites</h3>
            <ItemGroup className="gap-2">
              {invites.map((invite) => (
                <Item key={invite.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    {invite.email ? <MailIcon /> : <LinkIcon />}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate">
                      {invite.email ?? "Anyone with the link and code"}
                    </ItemTitle>
                    <ItemDescription>
                      Expires {formatRelative(invite.expiresAt)}
                      {invite.attemptsLeft < 5 &&
                        ` · ${invite.attemptsLeft} wrong code${invite.attemptsLeft === 1 ? "" : "s"} left before it locks`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <CancelInviteButton inviteId={invite.id} />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InviteDialog({
  providerId,
  providerName,
}: {
  providerId: string
  providerName: string
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [days, setDays] = useState("7")
  const [created, setCreated] = useState<{
    url: string
    code: string
    expiresAt: string
    email: string | null
  } | null>(null)
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Drop the link and code from memory once the dialog closes.
      setCreated(null)
      setEmail("")
      setDays("7")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createProviderInvite(providerId, {
        email,
        days: Number(days) as 1 | 7 | 30,
      })
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "The invite wasn't created" : result.error)
        return
      }
      setCreated({ ...result.data, email: email.trim() || null })
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" data-tour="provider-share-invite">
          <UserPlusIcon />
          Invite someone
        </Button>
      </DialogTrigger>
      <DialogContent
        onInteractOutside={(event) => {
          if (created) event.preventDefault()
        }}
      >
        {created ? (
          <div className="grid min-w-0 gap-5">
            <DialogHeader>
              <DialogTitle>Invite created</DialogTitle>
              <DialogDescription>
                Send both to {created.email ?? "the person you're sharing with"}
                . They open the link, sign in, and enter the code.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="invite-link">Link</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="invite-link"
                  readOnly
                  value={created.url}
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                  <CopyButton
                    content={created.url}
                    variant="ghost"
                    size="xs"
                    aria-label="Copy link"
                    onCopiedChange={(copied) => {
                      if (copied) toast.success("Link copied")
                    }}
                  />
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-code">Code</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="invite-code"
                  readOnly
                  value={created.code}
                  className="font-mono text-lg tracking-[0.4em]"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                  <CopyButton
                    content={created.code}
                    variant="ghost"
                    size="xs"
                    aria-label="Copy code"
                    onCopiedChange={(copied) => {
                      if (copied) toast.success("Code copied")
                    }}
                  />
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Alert>
              <ShieldAlertIcon />
              <AlertTitle>Send them separately</AlertTitle>
              <AlertDescription>
                For example the link by email and the code by chat, so one
                leaked message isn&apos;t enough. The invite works once, expires{" "}
                {formatRelative(created.expiresAt)}, and this code isn&apos;t
                shown again.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-6">
            <DialogHeader>
              <DialogTitle>Share {providerName}</DialogTitle>
              <DialogDescription>
                Their apps can use this provider&apos;s models with your key
                until you take access back. They can&apos;t see the key or share
                it further.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="invite-email">
                  Their email{" "}
                  <span className="font-normal text-muted-foreground">
                    (recommended)
                  </span>
                </FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <FieldDescription>
                  Only the account with this email can accept. Leave it empty to
                  let anyone with both the link and the code accept.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-expiry">Expires after</FieldLabel>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="invite-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_DAYS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={String(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : <UserPlusIcon />}
                Create invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RevokeButton({
  providerId,
  providerName,
  email,
}: {
  providerId: string
  providerName: string
  email: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          {pending && <Spinner />}
          Take back
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take back access from {email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their apps stop using {providerName} within about 15 seconds; a
            request already running finishes. To share it again, send a new
            invite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep access</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await revokeProviderShare(providerId, email)
                if (result.ok) toast.success(result.message)
                else toast.error(result.error)
              })
            }
          >
            Take back access
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CancelInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelProviderInvite(inviteId)
          if (result.ok) toast.success(result.message)
          else toast.error(result.error)
        })
      }
    >
      {pending && <Spinner />}
      Cancel
    </Button>
  )
}
