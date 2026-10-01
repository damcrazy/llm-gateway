import { KeyRoundIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatRelative } from "@/lib/format"

import { keyStatus, maskKey, type ApiKeyListRow, type KeyStatus } from "../_lib"
import { CreateKeyDialog, RevokeKeyButton } from "./app-controls"

const STATUS_BADGE: Record<
  KeyStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  active: { label: "Active", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Revoked", variant: "destructive" },
}

export function KeysSection({
  appId,
  keys,
}: {
  appId: string
  keys: ApiKeyListRow[]
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Only a hash of each key is stored. Revoke keys you no longer use.
        </p>
        <CreateKeyDialog appId={appId} />
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          {keys.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No API keys</EmptyTitle>
                <EmptyDescription>
                  Create a key to start calling the gateway from this app.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => {
                  const status = keyStatus(key)
                  const badge = STATUS_BADGE[status]
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="pl-6 font-medium">
                        {key.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {maskKey(key)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(key.created_at)}
                        {key.created_by && (
                          <span className="block text-xs">
                            by {key.created_by}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(key.last_used_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.expires_at
                          ? formatDateTime(key.expires_at)
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {status !== "revoked" && (
                          <RevokeKeyButton
                            appId={appId}
                            keyId={key.id}
                            name={key.name}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
