"use client";

import { useEffect, useId, useRef, useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";
import { Field, type TextareaRows, textareaClassFor } from "@/components/ui/form";

/**
 * A labeled, read-only, select-on-focus snippet box with a copy button.
 * Client-only: a Server Component can't hand an event handler like `onFocus`
 * to a DOM element (RSC serialization boundary) — this whole interactive
 * unit lives on the client so both the select-on-focus and the copy button
 * actually work.
 *
 * **Copy is a button in the box's top-right corner** (visual review
 * 2026-10-24, A45): a bare word on the line under the box read as text, not
 * an act. The box keeps room at its end for it, so the code never runs under.
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
  /** The box's fewest lines; it grows to show the whole snippet. */
  rows: TextareaRows;
  snippet: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const id = useId();
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    const ok = await copyToClipboard(snippet);
    setStatus(ok ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 4000);
  }

  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <textarea
          id={id}
          readOnly
          rows={rows}
          value={snippet}
          onFocus={(event) => event.currentTarget.select()}
          className={`${textareaClassFor(rows)} pe-24 font-mono text-xs print:hidden`}
        />
        <span
          data-print-snippet
          className="hidden whitespace-pre-wrap break-all font-mono text-xs print:block"
        >
          {snippet}
        </span>
        <button
          type="button"
          onClick={copy}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "absolute end-2 top-2 print:hidden",
          })}
        >
          <span aria-live="polite" className={status === "failed" ? "text-danger" : undefined}>
            {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : copyLabel}
          </span>
        </button>
      </div>
    </Field>
  );
}
