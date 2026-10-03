import Link from "next/link"
import { ArrowRightIcon, BoxesIcon, CpuIcon, KeyRoundIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { SessionMember } from "@/lib/auth"
import { formatUsd } from "@/lib/format"

const STEPS = [
  {
    title: "Create an app",
    description: "One per project, so usage and keys stay separate.",
    href: "/apps",
    icon: BoxesIcon,
  },
  {
    title: "Generate an API key",
    description: "Open the app, create a key and copy the integration snippet.",
    href: "/apps",
    icon: KeyRoundIcon,
  },
  {
    title: "Pick a model",
    description: "See which routes and models your account can call.",
    href: "/models",
    icon: CpuIcon,
  },
]

/** First-run view for members (they can't configure providers or routes). */
export function MemberWelcome({ member }: { member: SessionMember }) {
  const access =
    member.modelAccess === "free"
      ? "free models"
      : member.modelAccess === "allowlist"
        ? "the routes and models the owner picked for you"
        : "every model on this gateway"

  return (
    <Card data-tour="overview-member-welcome">
      <CardContent>
        <Empty className="p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxesIcon />
            </EmptyMedia>
            <EmptyTitle>Welcome</EmptyTitle>
            <EmptyDescription>
              Your account can use {access}
              {member.monthlyBudgetUsd != null &&
                `, up to ${formatUsd(member.monthlyBudgetUsd)} a month`}
              . Usage from your apps shows up here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-lg">
            <ItemGroup className="w-full gap-2">
              {STEPS.map((step) => (
                <Item key={step.title} variant="outline" asChild>
                  <Link href={step.href}>
                    <ItemMedia variant="icon">
                      <step.icon />
                    </ItemMedia>
                    <ItemContent className="text-left">
                      <ItemTitle>{step.title}</ItemTitle>
                      <ItemDescription>{step.description}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ArrowRightIcon className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
            <Button asChild>
              <Link href="/apps">Create your first app</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  )
}
