"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { RotateCcwIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { OtpCodeInput } from "@/components/otp-code-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

/**
 * Enrolls an authenticator app (TOTP) with Supabase MFA: shows a QR code and
 * the secret, then verifies a code from the app. On success the session is
 * upgraded to aal2 and `onEnrolled` runs.
 */
export function TotpEnroll({
  supabaseUrl,
  supabaseKey,
  friendlyName,
  onEnrolled,
}: {
  supabaseUrl: string
  supabaseKey: string
  friendlyName: string
  onEnrolled: () => void
}) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const started = useRef(false)

  const start = useCallback(async () => {
    setError(null)
    setEnrollment(null)
    setCode("")
    const supabase = createBrowserClient(supabaseUrl, supabaseKey)
    // Drop half-finished enrollments from earlier attempts.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const factor of existing?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName,
      issuer: "LLM Gateway",
    })
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Couldn't start setup")
      return
    }
    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    })
  }, [supabaseUrl, supabaseKey, friendlyName])

  useEffect(() => {
    // Guard against React running the effect twice in development.
    if (started.current) return
    started.current = true
    void start()
  }, [start])

  async function verify(value: string) {
    if (!enrollment || verifying) return
    setVerifying(true)
    setError(null)
    const supabase = createBrowserClient(supabaseUrl, supabaseKey)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: value,
    })
    setVerifying(false)
    if (verifyError) {
      setCode("")
      setError(
        verifyError.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That code didn't match. Check the time on your phone and try the newest code."
      )
      return
    }
    onEnrolled()
  }

  return (
    <div className="grid gap-5">
      <ol className="grid gap-1 text-sm text-muted-foreground">
        <li>
          1. Open an authenticator app (Google Authenticator, 1Password, Authy,
          Microsoft Authenticator…).
        </li>
        <li>2. Scan the QR code, or enter the setup key by hand.</li>
        <li>3. Enter the 6-digit code it shows.</li>
      </ol>

      <div className="grid justify-items-center gap-3">
        {enrollment ? (
          // The QR code is an inline SVG data URL from Supabase.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={enrollment.qrCode}
            alt="QR code for your authenticator app"
            className="size-44 rounded-lg bg-white p-2"
          />
        ) : (
          <Skeleton className="size-44 rounded-lg" />
        )}
        {enrollment && (
          <div className="flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-2 py-1">
            <code className="truncate font-mono text-xs">
              {enrollment.secret}
            </code>
            <CopyButton
              type="button"
              content={enrollment.secret}
              variant="ghost"
              size="xs"
              aria-label="Copy setup key"
            />
          </div>
        )}
      </div>

      <div className="grid justify-items-center gap-2">
        <OtpCodeInput
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={!enrollment || verifying}
        />
        {verifying && <Spinner />}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {error}
            {!enrollment && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void start()}
              >
                <RotateCcwIcon />
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
