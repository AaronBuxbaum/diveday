"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fillField } from "./AssistDraftButton";

/**
 * **A field drafted from a PDF the owner chooses** (ADR
 * 20261018-claude-assists; the `waiver-import` assist). The file input has no
 * `name`, so the form around it never submits the file: the bytes go only to
 * `draft`, and the text it answers fills the field for the owner to read and
 * edit. Nothing is saved or published by this control.
 */
export function PdfDraftButton({
  draft,
  fieldId,
  words,
}: {
  /** A server action answering the drafted text, or null. */
  draft: (formData: FormData) => Promise<string | null>;
  fieldId: string;
  words: { label: string; hint: string; draft: string; drafting: string; failed: string };
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function run() {
    const file = input.current?.files?.[0];
    if (!file) {
      input.current?.click();
      return;
    }
    const body = new FormData();
    body.set("pdf", file);
    setFailed(false);
    startTransition(async () => {
      let text: string | null = null;
      try {
        text = await draft(body);
      } catch {
        text = null;
      }
      if (!text?.trim()) {
        setFailed(true);
        return;
      }
      fillField(fieldId, text);
    });
  }

  return (
    <div className="grid gap-2 rounded-inset bg-surface-sunken px-4 py-3">
      <p className="text-sm font-medium text-foreground">{words.label}</p>
      <p className="text-sm text-muted">{words.hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          aria-label={words.label}
          className="text-sm"
          onChange={() => setFailed(false)}
        />
        <button
          type="button"
          onClick={run}
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClass({ variant: "ghost", size: "sm", busy: pending })}
        >
          {pending ? words.drafting : words.draft}
        </button>
      </div>
      {failed ? (
        <p className="text-sm text-danger" role="alert">
          {words.failed}
        </p>
      ) : null}
    </div>
  );
}
