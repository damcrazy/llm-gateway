import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { buildSnippets, ENDPOINTS } from "./_snippets"
import { QuickStart } from "./quick-start"

export function IntegrateSection({
  origin,
  model,
  extraModels,
}: {
  origin: string
  model: string
  extraModels: string[]
}) {
  const snippets = buildSnippets({ origin, model, extraModels })

  return (
    <div className="grid min-w-0 gap-6">
      <Card className="gap-4 pb-0" data-tour="app-integrate-endpoints">
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>
            Authenticate with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              Authorization: Bearer &lt;key&gt;
            </code>
            . The{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              x-api-key
            </code>{" "}
            header is also accepted.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Method</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Streaming</TableHead>
                <TableHead className="w-12 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENDPOINTS.map((endpoint) => {
                const url = `${origin}${endpoint.path}`
                return (
                  <TableRow key={endpoint.path}>
                    <TableCell className="pl-6">
                      <Badge variant="outline" className="font-mono">
                        {endpoint.method}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{url}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {endpoint.format}
                    </TableCell>
                    <TableCell>
                      {endpoint.streaming ? (
                        <Badge variant="secondary" className="font-normal">
                          {endpoint.streaming}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <CopyButton
                        content={url}
                        variant="ghost"
                        size="xs"
                        aria-label={`Copy ${endpoint.path} URL`}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <QuickStart snippets={snippets} model={model} />
    </div>
  )
}
