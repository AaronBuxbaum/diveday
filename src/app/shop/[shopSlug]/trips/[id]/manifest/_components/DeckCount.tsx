"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/group-label";
import { StatusMark } from "@/components/ui/StatusMark";
import { DECK_COUNT_MAX } from "@/lib/deck-count";

/** The deck count's answer: saved, refused, or nothing yet. */
export type DeckCountResult = { ok: true } | { ok: false } | null;

export type DeckCountAction = (
  prev: DeckCountResult,
  formData: FormData,
) => Promise<DeckCountResult>;

export type DeckCountCopy = {
  heading: string;
  label: string;
  hint: string;
  submit: string;
  refusal: string;
  /** Once a count stands at this checkpoint: the lines, composed server-side. */
  reading?: {
    tone: "agrees" | "differs";
    lines: string[];
    /** "Keiko Tanaka · 7:04 AM": who counted, and when. */
    recordedLine: string;
  };
};

/**
 * **The deck count** (loop 5, row 1; `src/lib/deck-count.ts`): the captain
 * types the heads counted on deck, and the page agrees or names the gap. A
 * second count beside the per-person marks that **informs and never gates**:
 * it closes nothing, opens nothing and refuses nothing.
 *
 * A safety surface, so the reading never leans on colour alone: an agreeing
 * count wears the success mark and the word "agrees", a differing one the
 * danger tone and the numbers in words, announced as a status.
 */
export function DeckCount({
  action,
  copy,
  idPrefix = "",
}: {
  action: DeckCountAction;
  copy: DeckCountCopy;
  /** Scopes the field id to one departure, as the roll call's own ids are. */
  idPrefix?: string;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const inputId = `${idPrefix}deck-count-input`;
  const reading = copy.reading;
  return (
    <section aria-label={copy.heading} className="mt-4 print:hidden">
      <h2 className={groupLabelClass()}>{copy.heading}</h2>
      {reading ? (
        <div
          role="status"
          className={`mt-2 space-y-1 text-base ${
            reading.tone === "differs" ? "font-bold text-danger" : ""
          }`}
        >
          {reading.lines.map((line, index) => (
            <p key={line} className="flex items-start gap-1.5">
              {index === 0 && reading.tone === "agrees" ? (
                <span className="flex h-lh shrink-0 items-center">
                  <StatusMark variant="success" />
                </span>
              ) : null}
              <span>{line}</span>
            </p>
          ))}
          <p className="text-sm font-normal text-muted tabular-nums">{reading.recordedLine}</p>
        </div>
      ) : null}
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={copy.label} description={copy.hint} htmlFor={inputId} className="w-48">
          <input
            id={inputId}
            name="counted"
            type="number"
            inputMode="numeric"
            min={0}
            max={DECK_COUNT_MAX}
            step={1}
            required
            className={`${controlClass} tabular-nums`}
          />
        </Field>
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className={buttonClass({ variant: "secondary", size: "boat" })}
        >
          {copy.submit}
        </button>
      </form>
      {result && !result.ok ? <FormStatus className="mt-2">{copy.refusal}</FormStatus> : null}
    </section>
  );
}
