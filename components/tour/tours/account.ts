import type { TourDefinition } from "../types"

export const ACCOUNT_TOURS: TourDefinition[] = [
  {
    id: "account",
    version: 1,
    title: "Account & security",
    steps: [
      {
        title: "Your account and its security",
        body: "How you sign in, how your account is protected, and your preferences for this dashboard.",
      },
      {
        target: "account-sign-in",
        side: "bottom",
        title: "Sign-in methods",
        body: "You can sign in with your email and password, with Google, or both; they're the same account as long as the email matches. Set or change your password here. Nobody, not even the owner, can see it.",
      },
      {
        target: "account-2fa",
        side: "top",
        title: "Two-factor authentication",
        body: "Everyone needs an authenticator app (Google Authenticator, 1Password, Authy…) as a second step when signing in. Add a second one as a backup; you can't remove the last one. Lost them all? Use <b>Email me a code</b> on the sign-in screen.",
      },
      {
        target: "account-tours",
        side: "top",
        title: "Guided tours",
        body: "Turn off the tours that start on each new page, or show them all again. The compass button at the top right replays the current page's tour whenever you like.",
      },
    ],
  },
]
