"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog"

import { deleteRoute } from "../actions"

export function DeleteRouteButton({
  id,
  name,
  usedBy,
}: {
  id: string
  name: string
  usedBy: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete route {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests that send{" "}
            <code className="font-mono">
              &quot;model&quot;: &quot;{name}&quot;
            </code>{" "}
            will start failing. Past request logs are kept.
            {usedBy.length > 0 && (
              <>
                {" "}
                It&apos;s referenced by{" "}
                {usedBy.length === 1 ? "the app" : "these apps"}:{" "}
                <span className="font-medium text-foreground">
                  {usedBy.join(", ")}
                </span>
                .
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              startTransition(async () => {
                const result = await deleteRoute(id)
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success(result.message)
                router.push("/routes")
              })
            }
          >
            Delete route
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
