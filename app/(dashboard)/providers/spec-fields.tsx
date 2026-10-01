"use client"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { FieldSpec } from "@/lib/providers/catalog"

import type { FieldValues } from "./shared"

/** Renders the config or credential fields a provider type declares. */
export function SpecFields({
  idPrefix,
  fields,
  values,
  onChange,
  secret = false,
}: {
  idPrefix: string
  fields: FieldSpec[]
  values: FieldValues
  onChange: (key: string, value: string) => void
  /** Credential fields: password inputs, no autofill. */
  secret?: boolean
}) {
  return fields.map((field) => {
    const id = `${idPrefix}-${field.key}`
    return (
      <Field key={field.key}>
        <FieldLabel htmlFor={id}>
          {field.label}
          {field.required && (
            <span className="text-destructive" aria-hidden>
              *
            </span>
          )}
        </FieldLabel>
        {field.multiline ? (
          <Textarea
            id={id}
            required={field.required}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="max-h-60 min-h-28 font-mono text-xs md:text-xs"
            value={values[field.key] ?? ""}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        ) : (
          <Input
            id={id}
            type={
              secret ? "password" : field.key === "baseUrl" ? "url" : "text"
            }
            required={field.required}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete={secret ? "new-password" : "off"}
            className={
              secret || field.key === "baseUrl" ? "font-mono" : undefined
            }
            value={values[field.key] ?? ""}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        )}
        {field.help && <FieldDescription>{field.help}</FieldDescription>}
      </Field>
    )
  })
}
