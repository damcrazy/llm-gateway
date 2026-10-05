"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { TotpEnroll } from "@/components/totp-enroll"

export function SetupClient({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string
  supabaseKey: string
}) {
  const router = useRouter()
  return (
    <TotpEnroll
      supabaseUrl={supabaseUrl}
      supabaseKey={supabaseKey}
      friendlyName="Authenticator app"
      onEnrolled={() => {
        toast.success("Two-factor authentication is on")
        router.replace("/auth/continue")
        router.refresh()
      }}
    />
  )
}
