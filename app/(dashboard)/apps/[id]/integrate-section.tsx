import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs"
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

import { buildSnippets, ENDPOINTS, KEY_PLACEHOLDER } from "./_snippets"

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-4">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {title}
        </span>
        <CopyButton
          content={code}
          variant="ghost"
          size="xs"
          aria-label={`Copy ${title}`}
        />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

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
      <Card className="gap-4 pb-0">
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

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>
            Replace <code className="font-mono">{KEY_PLACEHOLDER}</code> with a
            key from the Keys tab. Snippets call{" "}
            <code className="font-mono">{model}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          <Tabs defaultValue={snippets[0].value} className="min-w-0 gap-4">
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList>
                {snippets.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContents className="-m-1 p-1">
              {snippets.map((tab) => (
                <TabsContent
                  key={tab.value}
                  value={tab.value}
                  className="min-w-0"
                >
                  <div className="grid min-w-0 gap-4">
                    {tab.blocks.map((block) => (
                      <CodeBlock key={block.title} {...block} />
                    ))}
                  </div>
                </TabsContent>
              ))}
            </TabsContents>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
