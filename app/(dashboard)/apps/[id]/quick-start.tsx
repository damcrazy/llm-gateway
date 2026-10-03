"use client"

import { useState } from "react"
import { InfoIcon } from "lucide-react"

import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { KEY_PLACEHOLDER, type SnippetMode, type SnippetTab } from "./_snippets"

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

/** Copy-paste snippets, as a full response or streamed token by token. */
export function QuickStart({
  snippets,
  model,
}: {
  snippets: SnippetTab[]
  model: string
}) {
  const [mode, setMode] = useState<SnippetMode>("full")

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Quick start</CardTitle>
        <CardDescription>
          Replace <code className="font-mono">{KEY_PLACEHOLDER}</code> with a
          key from the Keys tab. Snippets call{" "}
          <code className="font-mono">{model}</code>.
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(next) => next && setMode(next as SnippetMode)}
            aria-label="Response style"
          >
            <ToggleGroupItem value="full" className="px-3">
              Full response
            </ToggleGroupItem>
            <ToggleGroupItem value="stream" className="px-3">
              Streaming
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {mode === "stream" && (
          <Alert>
            <InfoIcon />
            <AlertTitle>How streaming works</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  Send <code className="font-mono">stream: true</code>. Tokens
                  arrive as server-sent events (
                  <code className="font-mono">data: {"{…}"}</code> lines),
                  ending with <code className="font-mono">data: [DONE]</code>.{" "}
                  <code className="font-mono">/v1/messages</code> streams
                  Anthropic events instead.
                </li>
                <li>
                  Failover happens before the first token: if a model fails, is
                  rate-limited or doesn&apos;t start within 2 minutes, the next
                  model in the bucket answers and your stream never sees the
                  error. Once text is flowing, a failure ends the stream with an
                  error event.
                </li>
                <li>
                  Usage is always recorded. Add{" "}
                  <code className="font-mono">
                    stream_options: {"{ include_usage: true }"}
                  </code>{" "}
                  to also get token counts in the final chunk.
                </li>
                <li>A single stream can run for up to 5 minutes.</li>
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue={snippets[0]!.value} className="min-w-0 gap-4">
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
                  {tab.blocks
                    .filter((block) => !block.mode || block.mode === mode)
                    .map((block) => (
                      <CodeBlock key={block.title} {...block} />
                    ))}
                </div>
              </TabsContent>
            ))}
          </TabsContents>
        </Tabs>
      </CardContent>
    </Card>
  )
}
