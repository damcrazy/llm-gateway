"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
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
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import { EXPIRY_OPTIONS, type ExpiryValue } from "../_lib"
import {
  createApiKey,
  deleteApp,
  revokeApiKey,
  setAppEnabled,
} from "../actions"

export function AppEnabledSwitch({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  const [checked, setChecked] = useState(enabled)
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    setChecked(next)
    startTransition(async () => {
      const result = await setAppEnabled(id, next)
      if (result.ok) {
        toast.success(result.message)
      } else {
        setChecked(!next)
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <Switch
        id="app-enabled"
        checked={checked}
        disabled={pending}
        onCheckedChange={toggle}
      />
      <Label htmlFor="app-enabled" className="min-w-16">
        {checked ? "Enabled" : "Disabled"}
      </Label>
    </div>
  )
}

export function CreateKeyDialog({ appId }: { appId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [expiry, setExpiry] = useState<ExpiryValue>("never")
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Drop the plaintext key from memory as soon as the dialog closes.
      setCreatedKey(null)
      setName("")
      setExpiry("never")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createApiKey(appId, { name, expiry })
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "The key was not returned" : result.error)
        return
      }
      setCreatedKey(result.data.key)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent
        onInteractOutside={(event) => {
          if (createdKey) event.preventDefault()
        }}
      >
        {createdKey ? (
          <div className="grid min-w-0 gap-4">
            <DialogHeader>
              <DialogTitle>Your new API key</DialogTitle>
              <DialogDescription>
                Use it as a Bearer token (or x-api-key header) when calling the
                gateway.
              </DialogDescription>
            </DialogHeader>
            <InputGroup>
              <InputGroupInput
                readOnly
                aria-label="API key"
                value={createdKey}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <InputGroupAddon align="inline-end">
                <CopyButton
                  content={createdKey}
                  variant="ghost"
                  size="xs"
                  aria-label="Copy API key"
                  onCopiedChange={(copied) => {
                    if (copied) toast.success("Key copied")
                  }}
                />
              </InputGroupAddon>
            </InputGroup>
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>Copy it now</AlertTitle>
              <AlertDescription>
                This key won&apos;t be shown again. Only a hash is stored, so a
                lost key has to be revoked and replaced.
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
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Keys are shown once. Create one per environment or machine so
                you can revoke them independently.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="key-name">Name</FieldLabel>
                <Input
                  id="key-name"
                  required
                  autoFocus
                  maxLength={80}
                  placeholder="Production"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key-expiry">Expires</FieldLabel>
                <Select
                  value={expiry}
                  onValueChange={(value) => setExpiry(value as ExpiryValue)}
                >
                  <SelectTrigger id="key-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.days ? `In ${option.label}` : option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? <Spinner /> : <KeyRoundIcon />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RevokeKeyButton({
  appId,
  keyId,
  name,
}: {
  appId: string
  keyId: string
  name: string
}) {
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          {pending && <Spinner />}
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests using this key start failing with 401 right away. This
            can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await revokeApiKey(appId, keyId)
                if (result.ok) toast.success(result.message)
                else toast.error(result.error)
              })
            }
          >
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeleteAppButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending}>
          {pending ? <Spinner /> : <Trash2Icon />}
          Delete app
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The app and all of its API keys are deleted, so every client using
            them stops working. Request logs are kept but no longer linked to
            the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await deleteApp(id)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success(result.message)
                router.replace("/apps")
              })
            }
          >
            Delete app
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
