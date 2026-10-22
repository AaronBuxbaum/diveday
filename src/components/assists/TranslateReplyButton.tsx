"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { fillField } from "./AssistDraftButton";

/**
 * **Translate the reply before it goes** (ADR 20261018-claude-assists; the
 * `translate` assist). Reads what the staffer typed, asks for it in the
 * diver's language, and puts the translation in the box for them to send.
 * What they wrote stays on screen under the box, so both versions are in view
 * and a translation that reads wrong is caught before Send. A dark or failed
 * assist leaves the box as it was.
 */
export function TranslateReplyButton({
  fieldId,
  translate,
  label,
  pendingLabel,
  yourWords,
}: {
  fieldId: string;
  /** A server action answering the translation, or null. */
  translate: (text: string) => Promise<string | null>;
  label: string;
  pendingLabel: string;
  /** "What you wrote: {text}". */
  yourWords: string;
}) {
  const [pending, startTransition] = useTransition();
  const [original, setOriginal] = useState<string | null>(null);

  function run() {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLTextAreaElement)) return;
    const text = field.value.trim();
    if (!text) return;
    startTransition(async () => {
      let translation: string | null = null;
      try {
        translation = await translate(text);
      } catch {
        return;
      }
      if (!translation?.trim()) return;
      setOriginal(text);
      fillField(fieldId, translation);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClass({ variant: "ghost", size: "sm", busy: pending })}
      >
        {pending ? pendingLabel : label}
      </button>
      {original ? (
        <p className="basis-full whitespace-pre-wrap text-sm text-muted">
          {fill(yourWords, { text: original })}
        </p>
      ) : null}
    </>
  );
}
