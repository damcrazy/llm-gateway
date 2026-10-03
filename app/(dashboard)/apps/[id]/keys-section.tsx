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

import {
  describeKeyLimits,
  keyLimits,
  keyStatus,
  maskKey,
  type ApiKeyListRow,
  type KeyStatus,
} from "../_lib"
import { CreateKeyDialog, RevokeKeyButton } from "./app-controls"
import { KeyLimitsDialog } from "./key-limits"

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
      {keys.length === 0 ? (
        <Empty className="min-h-80 border" data-tour="app-keys-empty">
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
        <Card className="py-0" data-tour="app-keys-table">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead data-tour="app-keys-limits">Limits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-48 pr-6" />
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
                      <TableCell className="text-xs text-muted-foreground">
                        {describeKeyLimits(keyLimits(key)) ?? "App limits"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {status !== "revoked" && (
                          <div
                            className="flex justify-end gap-1"
                            data-tour="app-key-actions"
                          >
                            <KeyLimitsDialog
                              appId={appId}
                              keyId={key.id}
                              name={key.name}
                              limits={keyLimits(key)}
                            />
                            <RevokeKeyButton
                              appId={appId}
                              keyId={key.id}
                              name={key.name}
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
