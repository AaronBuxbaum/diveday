"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
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
}: {
  label: string;
  rows: number;
  snippet: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

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
          <button
            type="button"
            className={buttonClass({ variant: "secondary", size: "sm" })}
            aria-live="polite"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard permission denied or unavailable — the snippet is
                // still selectable text in the box above, nothing is lost.
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </Field>
  );
}
