import Link from "next/link"
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleIcon,
  RocketIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"

import type { Inventory } from "./data"

export function GettingStarted({
  inventory,
  className,
}: {
  inventory: Inventory
  className?: string
}) {
  const steps = [
    {
      href: "/providers",
      title: "Add a provider",
      description:
        "Connect OpenAI, Anthropic, Bedrock, Vertex, Gemini or any OpenAI-compatible API.",
      done: inventory.providers.enabled > 0,
    },
    {
      href: "/models",
      title: "Check capabilities & prices",
      description:
        "Enable the models you want and confirm their per-token prices.",
      done: inventory.models.enabled > 0,
    },
    {
      href: "/routes",
      title: "Create a route",
      description:
        "Put models behind a name like “smart” with ordered fallbacks.",
      done: inventory.routes.total > 0,
    },
    {
      href: "/apps",
      title: "Create an app and API key",
      description: "Each client gets its own key, limits and budget.",
      done: inventory.apps.total > 0 && inventory.activeKeys > 0,
    },
    {
      href: "/playground",
      title: "Send a test message",
      description: "Try a model or route from the playground.",
      done: false,
    },
  ]
  const completed = steps.filter((step) => step.done).length
  const next = steps.find((step) => !step.done)

  return (
    <Card
      data-tour="overview-getting-started"
      className={cn("min-w-0", className)}
    >
      <CardContent>
        <Empty className="p-4 md:p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RocketIcon />
            </EmptyMedia>
            <EmptyTitle>No traffic yet</EmptyTitle>
            <EmptyDescription>
              Usage charts show up here once requests flow through the gateway.{" "}
              {completed} of {steps.length} setup steps done.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-md">
            <ItemGroup className="gap-2 text-left">
              {steps.map((step) => (
                <Item
                  key={step.href}
                  asChild
                  size="sm"
                  variant={step === next ? "outline" : "default"}
                >
                  <Link href={step.href}>
                    <ItemMedia variant="icon">
                      {step.done ? (
                        <CircleCheckIcon className="text-primary" />
                      ) : (
                        <CircleIcon className="text-muted-foreground" />
                      )}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle
                        className={cn(step.done && "text-muted-foreground")}
                      >
                        {step.title}
                      </ItemTitle>
                      <ItemDescription>{step.description}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {step.done ? (
                        <Badge variant="secondary">Done</Badge>
                      ) : (
                        <ArrowRightIcon
                          className="size-4 text-muted-foreground"
                          aria-label="To do"
                        />
                      )}
                    </ItemActions>
                  </Link>
                </Item>
              ))}
            </ItemGroup>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  )
}
