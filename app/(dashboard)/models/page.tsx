import type { Metadata } from "next"
import Link from "next/link"
import { CpuIcon, InfoIcon, ServerIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { requireMember } from "@/lib/auth"

import { AvailableModels } from "./available-models"
import { loadModelList } from "./data"
import { ModelsExplorer } from "./models-table"

export const metadata: Metadata = { title: "Models" }

export default async function ModelsPage() {
  const me = await requireMember()
  if (!me.isAdmin) {
    return (
      <>
        <PageHeader
          title="Models"
          description="The routes and models your API keys can call."
        />
        <AvailableModels member={me} />
      </>
    )
  }
  // Members' own providers are theirs to manage, not part of this list.
  const { models, providers } = await loadModelList({ sharedOnly: true })

  return (
    <>
      <PageHeader
        title="Models"
        description="Every model across the shared providers. Clients can call any enabled model by its slug, or through a route."
        actions={
          <Button variant="outline" asChild>
            <Link href="/providers">
              <ServerIcon />
              Providers
            </Link>
          </Button>
        }
      />

      <Alert>
        <InfoIcon />
        <AlertTitle>Capabilities and tags</AlertTitle>
        <AlertDescription>
          <p>
            The router automatically skips models that lack a capability a
            request needs (tool calling, vision, structured output, PDF or audio
            input), so keep capabilities accurate. Tags are free-form categories
            such as fast, cheap or coding, for filtering and organising.
          </p>
        </AlertDescription>
      </Alert>

      {models.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CpuIcon />
                </EmptyMedia>
                <EmptyTitle>No models yet</EmptyTitle>
                <EmptyDescription>
                  Models belong to a provider. Open a provider to discover its
                  models or add one by id.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link href="/providers">
                    <ServerIcon />
                    Go to providers
                  </Link>
                </Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <ModelsExplorer
          models={models}
          providers={providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
          }))}
        />
      )}
    </>
  )
}
