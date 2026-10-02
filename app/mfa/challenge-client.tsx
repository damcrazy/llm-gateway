"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"
import { ChevronDownIcon, MailIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { OtpCodeInput } from "@/components/otp-code-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

import { sendRecoveryEmail, verifyRecoveryEmail } from "./actions"

export function ChallengeClient({
  email,
  supabaseUrl,
  supabaseKey,
}: {
  email: string
  supabaseUrl: string
  supabaseKey: string
}) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  async function verify(value: string) {
    if (verifying) return
    setVerifying(true)
    setError(null)
    const supabase = createBrowserClient(supabaseUrl, supabaseKey)
    const { data } = await supabase.auth.mfa.listFactors()
    // With a backup device there can be several; a code fits only its own.
    let verified = false
    for (const factor of data?.totp ?? []) {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify(
        { factorId: factor.id, code: value }
      )
      if (!verifyError) {
        verified = true
        break
      }
      if (verifyError.status === 429) {
        setError("Too many attempts. Wait a minute and try again.")
        break
      }
    }
    setVerifying(false)
    if (!verified) {
      setCode("")
      setError(
        (current) => current ?? "That code didn't match. Try the newest code."
      )
      return
    }
    router.replace("/")
    router.refresh()
  }

  return (
    <div className="grid gap-5">
      <div className="grid justify-items-center gap-2">
        <OtpCodeInput
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={verifying}
        />
        {verifying && <Spinner />}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Separator />
      <EmailFallback
        email={email}
        onRecovered={() => {
          router.replace("/mfa/setup")
          router.refresh()
        }}
      />
    </div>
  )
}

/** Lost authenticator: verify an emailed code, then set up a new app. */
function EmailFallback({
  email,
  onRecovered,
}: {
  email: string
  onRecovered: () => void
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send() {
    setError(null)
    startTransition(async () => {
      const result = await sendRecoveryEmail()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSent(true)
      toast.success(result.message)
    })
  }

  function verify(value: string) {
    setError(null)
    startTransition(async () => {
      const result = await verifyRecoveryEmail(value)
      if (!result.ok) {
        setCode("")
        setError(result.error)
        return
      }
      toast.success(result.message)
      onRecovered()
    })
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group w-full justify-between text-muted-foreground"
        >
          Lost access to your authenticator app?
          <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3">
        <p className="text-sm text-muted-foreground">
          We&apos;ll email a one-time code to {email}. After you enter it, your
          old authenticator is removed and you&apos;ll set up a new one.
        </p>
        {!sent ? (
          <Button
            type="button"
            variant="outline"
            onClick={send}
            disabled={pending}
          >
            {pending ? <Spinner /> : <MailIcon />}
            Email me a code
          </Button>
        ) : (
          <div className="grid justify-items-center gap-2">
            <OtpCodeInput
              value={code}
              onChange={setCode}
              onComplete={verify}
              disabled={pending}
            />
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={send}
              disabled={pending}
            >
              Send a new code
            </Button>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
