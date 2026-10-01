"use client"

import { useState } from "react"
import { EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react"

import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { generatePassword } from "@/lib/password"

/** Password input with show/hide, and optionally generate + copy. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "new-password",
  generate = false,
  required = true,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  generate?: boolean
  required?: boolean
}) {
  const [visible, setVisible] = useState(generate)

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        className="font-mono"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
        {generate && (
          <>
            <InputGroupButton
              size="icon-xs"
              aria-label="Generate password"
              onClick={() => {
                onChange(generatePassword())
                setVisible(true)
              }}
            >
              <RefreshCwIcon />
            </InputGroupButton>
            <CopyButton
              type="button"
              content={value}
              variant="ghost"
              size="xs"
              className="size-6"
              disabled={!value}
              aria-label="Copy password"
            />
          </>
        )}
      </InputGroupAddon>
    </InputGroup>
  )
}
