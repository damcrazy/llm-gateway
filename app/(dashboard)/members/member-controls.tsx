"use client"

import { useId, useState, useTransition } from "react"
import {
  KeyRoundIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
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
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/animate-ui/components/radix/radio-group"
import {
  ModelMultiSelect,
  type ModelOptions,
} from "@/components/model-multi-select"
import { PasswordInput } from "@/components/password-input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import type { ModelAccess } from "@/lib/db/types"
import { MIN_PASSWORD_LENGTH, generatePassword } from "@/lib/password"

import {
  addMember,
  removeMember,
  resetMemberPassword,
  updateMember,
} from "./actions"
import {
  DEFAULT_MEMBER_ACCESS,
  MODEL_ACCESS_OPTIONS,
  type MemberAccessInput,
} from "./shared"

const PASSWORD_HELP = `At least ${MIN_PASSWORD_LENGTH} characters. Copy it now and share it securely; they can change it after signing in.`

const ROLE_OPTIONS: {
  value: MemberAccessInput["role"]
  label: string
  description: string
}[] = [
  {
    value: "member",
    label: "Member",
    description:
      "Creates their own apps and API keys, and sees only their own usage and logs.",
  },
  {
    value: "admin",
    label: "Admin",
    description:
      "Manages providers, models, routes and every app. Can't manage people.",
  },
]

function OptionCards<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; description: string }[]
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className="gap-2"
    >
      {options.map((option) => (
        <FieldLabel
          key={option.value}
          htmlFor={`${name}-${option.value}`}
          className="has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
        >
          <Field orientation="horizontal">
            <RadioGroupItem
              value={option.value}
              id={`${name}-${option.value}`}
            />
            <FieldContent>
              <FieldTitle>{option.label}</FieldTitle>
              <FieldDescription className="text-xs">
                {option.description}
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

/** Role, model access and budget fields shared by the add and edit dialogs. */
function AccessFields({
  value,
  onChange,
  options,
}: {
  value: MemberAccessInput
  onChange: (value: MemberAccessInput) => void
  options: ModelOptions
}) {
  const uid = useId()
  const [budgetText, setBudgetText] = useState(
    value.monthly_budget_usd == null ? "" : String(value.monthly_budget_usd)
  )
  const set = <K extends keyof MemberAccessInput>(
    key: K,
    next: MemberAccessInput[K]
  ) => onChange({ ...value, [key]: next })

  return (
    <>
      <Field>
        <FieldTitle>Role</FieldTitle>
        <OptionCards
          name={`${uid}-role`}
          value={value.role}
          onChange={(role) => set("role", role)}
          options={ROLE_OPTIONS}
        />
      </Field>
      {value.role === "member" && (
        <>
          <Field>
            <FieldTitle>Model access</FieldTitle>
            <OptionCards<ModelAccess>
              name={`${uid}-access`}
              value={value.model_access}
              onChange={(access) => set("model_access", access)}
              options={MODEL_ACCESS_OPTIONS}
            />
            {value.model_access === "allowlist" && (
              <ModelMultiSelect
                id={`${uid}-allowed`}
                options={options}
                value={value.allowed_models}
                onChange={(allowed) => set("allowed_models", allowed)}
                placeholder="Pick routes and models"
              />
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-budget`}>Monthly budget</FieldLabel>
            <InputGroup className="sm:w-48">
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={`${uid}-budget`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="No cap"
                value={budgetText}
                onChange={(event) => {
                  setBudgetText(event.target.value)
                  const trimmed = event.target.value.trim()
                  set(
                    "monthly_budget_usd",
                    trimmed === "" ? null : Number(trimmed)
                  )
                }}
              />
            </InputGroup>
            <FieldDescription>
              Across all of their apps, per calendar month (UTC). Requests are
              refused once it&apos;s reached. Leave blank for no cap.
            </FieldDescription>
          </Field>
        </>
      )}
    </>
  )
}

export function AddMemberDialog({ options }: { options: ModelOptions }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [access, setAccess] = useState<MemberAccessInput>(DEFAULT_MEMBER_ACCESS)
  const [formKey, setFormKey] = useState(0)
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setEmail("")
      setPassword(generatePassword())
      setAccess(DEFAULT_MEMBER_ACCESS)
      setFormKey((key) => key + 1)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await addMember(email, password, access)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon />
          Add person
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form key={formKey} onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Creates their account. Share the email and starting password with
              them.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="member-email">Email</FieldLabel>
              <Input
                id="member-email"
                type="email"
                required
                autoFocus
                placeholder="friend@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-password">
                Starting password
              </FieldLabel>
              <PasswordInput
                id="member-password"
                value={password}
                onChange={setPassword}
                generate
              />
              <FieldDescription>{PASSWORD_HELP}</FieldDescription>
            </Field>
            <AccessFields
              value={access}
              onChange={setAccess}
              options={options}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Add person
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditAccessButton({
  email,
  access,
  options,
}: {
  email: string
  access: MemberAccessInput
  options: ModelOptions
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<MemberAccessInput>(access)
  const [formKey, setFormKey] = useState(0)
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setValue(access)
      setFormKey((key) => key + 1)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateMember(email, value)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit access for ${email}`}
        >
          <SlidersHorizontalIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form key={formKey} onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit access</DialogTitle>
            <DialogDescription>
              Changes apply to {email}&apos;s API keys within about 30 seconds.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <AccessFields value={value} onChange={setValue} options={options} />
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ResetPasswordButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) setPassword(generatePassword())
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await resetMemberPassword(email, password)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reset password for ${email}`}
        >
          <KeyRoundIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Sets a new password for {email}. Their current sessions stay
              signed in.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="reset-password">New password</FieldLabel>
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={setPassword}
              generate
            />
            <FieldDescription>{PASSWORD_HELP}</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveMemberButton({
  email,
  appCount,
}: {
  email: string
  appCount: number
}) {
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${email}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their account is deleted and any open session stops working.
            {appCount > 0 &&
              ` Their ${appCount} app${appCount === 1 ? "" : "s"} and every API key in ${appCount === 1 ? "it" : "them"} are deleted too, so those integrations stop working immediately.`}{" "}
            Past usage stays in the logs.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await removeMember(email)
                if (result.ok) toast.success(result.message)
                else toast.error(result.error)
              })
            }
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
