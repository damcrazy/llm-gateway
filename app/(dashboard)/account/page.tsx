import type { Metadata } from "next"
import { KeyRoundIcon, MailIcon, ShieldCheckIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { TourSettings } from "@/components/tour/tour-settings"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { requireMember, userHasPassword, verifiedTotpFactors } from "@/lib/auth"
import { env } from "@/lib/env"
import { formatDateTime } from "@/lib/format"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getTimeZone } from "@/lib/time-zone-server"

import {
  AddAuthenticatorButton,
  ChangePasswordButton,
  SetPasswordButton,
  RemoveAuthenticatorButton,
} from "./account-controls"

export const metadata: Metadata = { title: "Account & security" }

const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Admin",
  member: "Member",
}

export default async function AccountPage() {
  const me = await requireMember()
  const timeZone = await getTimeZone()
  const [factors, { data: userData }, hasPassword] = await Promise.all([
    verifiedTotpFactors(me.id),
    supabaseAdmin().auth.admin.getUserById(me.id),
    userHasPassword(me.id),
  ])
  const identities = userData.user?.identities ?? []
  const hasGoogle = identities.some(
    (identity) => identity.provider === "google"
  )

  return (
    <>
      <PageTour id="account" />
      <PageHeader
        title="Account & security"
        description={
          <>
            {me.email} · {ROLE_LABELS[me.role]}
          </>
        }
      />

      <Card data-tour="account-sign-in">
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            Signing in with Google using {me.email} links it to this account
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-2">
            <Item variant="outline">
              <ItemMedia variant="icon">
                <MailIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Email and password</ItemTitle>
                <ItemDescription>
                  {hasPassword
                    ? "Forgot it? Use “Forgot password?” on the sign-in page."
                    : "No password yet: you sign in with Google. Set one to also sign in with your email."}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {hasPassword ? <ChangePasswordButton /> : <SetPasswordButton />}
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <KeyRoundIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Google</ItemTitle>
                <ItemDescription>
                  {hasGoogle
                    ? "Linked. You can use “Continue with Google”."
                    : "Not linked yet. It links the first time you continue with Google."}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {hasGoogle ? (
                  <Badge variant="secondary">Linked</Badge>
                ) : (
                  <Badge variant="outline">Not linked</Badge>
                )}
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <Card data-tour="account-2fa">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Required for every account. Add a second device as a backup; if you
            lose all of them, you can recover with a code sent to your email.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ItemGroup className="gap-2">
            {factors.map((factor) => (
              <Item key={factor.id} variant="outline">
                <ItemMedia variant="icon">
                  <ShieldCheckIcon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {factor.friendly_name || "Authenticator app"}
                  </ItemTitle>
                  <ItemDescription>
                    Added {formatDateTime(factor.created_at, timeZone)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <RemoveAuthenticatorButton
                    factorId={factor.id}
                    name={factor.friendly_name || "Authenticator app"}
                    isLast={factors.length <= 1}
                  />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          <div>
            <AddAuthenticatorButton
              supabaseUrl={env.supabaseUrl()}
              supabaseKey={env.supabasePublishableKey()}
              existingNames={factors.map(
                (factor) => factor.friendly_name ?? ""
              )}
            />
          </div>
        </CardContent>
      </Card>
      <Card data-tour="account-tours">
        <CardHeader>
          <CardTitle>Guided tours</CardTitle>
          <CardDescription>
            Short walkthroughs that explain each page of the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TourSettings />
        </CardContent>
      </Card>
    </>
  )
}
