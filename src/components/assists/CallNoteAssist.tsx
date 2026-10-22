"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import { buttonClass } from "@/components/ui/button";
import { Field, textareaClassFor } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { CALL_NOTE_MAX, type CallNoteReading } from "./call-note";

/**
 * **Took a call, typed as it came** (ADR 20261018-claude-assists; the
 * `call-note` assist). The staffer types the call the way they would on a
 * pad; Fill reads it into the form's own fields, in the form, for them to
 * check before Log. The note field gets the scribble exactly as typed, with
 * the callback time after it, so nothing they wrote is lost to the reading.
 * When the number or address belongs to a diver on file, the line under the
 * button links to them. Nothing is recorded until the form is submitted.
 *
 * Fields that appear only once the call's outcome is chosen are filled on a
 * second pass, after the outcome's own render.
 */
export function CallNoteAssist({
  read,
  words,
}: {
  read: (text: string) => Promise<CallNoteReading | null>;
  words: {
    label: string;
    hint: string;
    fill: string;
    filling: string;
    /** "On file: {name}". */
    onFile: string;
    nothing: string;
  };
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CallNoteReading | "nothing" | null>(null);

  function run() {
    const scribble = ref.current;
    const form = scribble?.closest("form");
    const text = scribble?.value.trim() ?? "";
    if (!form || !text) return;
    startTransition(async () => {
      let reading: CallNoteReading | null = null;
      try {
        reading = await read(text);
      } catch {
        reading = null;
      }
      if (!reading) {
        setResult("nothing");
        return;
      }
      const { outcome, ...rest } = reading.fields;
      if (outcome) applyFormFields(form, { outcome });
      // The outcome's fields mount on its render; fill them on the next frame.
      await new Promise((resolve) => setTimeout(resolve, 0));
      applyFormFields(form, rest);
      setResult(reading);
    });
  }

  return (
    <div className="mb-6 grid gap-2">
      <Field label={words.label} description={words.hint}>
        <textarea
          ref={ref}
          name="scribble"
          rows={3}
          maxLength={CALL_NOTE_MAX}
          className={textareaClassFor(3)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClass({ variant: "ghost", size: "sm", busy: pending })}
        >
          {pending ? words.filling : words.fill}
        </button>
        <p className="text-sm text-muted" aria-live="polite">
          {result === "nothing" ? (
            words.nothing
          ) : result?.match ? (
            <Link href={result.match.href} className="font-medium text-primary hover:underline">
              {fill(words.onFile, { name: result.match.name })}
            </Link>
          ) : null}
        </p>
      </div>
    </div>
  );
}
