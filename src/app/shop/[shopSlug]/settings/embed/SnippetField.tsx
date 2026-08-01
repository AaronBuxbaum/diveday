"use client";

import { Copyable } from "@/components/Copyable";
import { controlClass, Field } from "@/components/ui/form";

/**
 * A labeled, read-only, select-on-focus snippet box with a copy button.
 * Client-only: a Server Component can't hand an event handler like `onFocus`
 * to a DOM element (RSC serialization boundary) — this whole interactive
 * unit lives on the client so both the select-on-focus and the copy button
 * actually work.
 */
export function SnippetField({
  label,
  rows,
  snippet,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  label: string;
  rows: number;
  snippet: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  return (
    <Field label={label}>
      <div className="flex flex-col gap-2">
        <textarea
          readOnly
          rows={rows}
          value={snippet}
          onFocus={(event) => event.currentTarget.select()}
          className={`${controlClass} font-mono text-xs`}
        />
        <div>
          <Copyable
            layout="inline"
            value={snippet}
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
            failedLabel={failedLabel}
          />
        </div>
      </div>
    </Field>
  );
}
