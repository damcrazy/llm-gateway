"use client"

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"

/** Six-digit code entry (authenticator or emailed codes). */
export function OtpCodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus = true,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      inputMode="numeric"
      pattern="^[0-9]*$"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}
