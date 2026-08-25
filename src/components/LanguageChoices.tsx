"use client";

import { useTransition } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";

/** One language on offer: its tag, and its own name for itself. */
export type LanguageChoice = { locale: string; label: string };

/**
 * The languages DiveDay carries, as buttons — each one its own language's name
 * for itself, because the reader most likely to need this control is the one
 * who cannot read the label above it.
 *
 * A `<button>` per language rather than a `<select>`: a select would need its
 * own confirm step or an onChange that submits, which is the shape
 * screen-reader users are most often warned about. The one already in force is
 * marked `aria-current` and reads as selected rather than as somewhere to go.
 *
 * **`layout` is not decoration.** This used to be a wrapping row only, which
 * is a shape that quietly assumes a short list — a row of two reads as a pair
 * of alternatives, a wrapping row of nine reads as a paragraph of buttons. It
 * is a row only where a caller can guarantee the space (nowhere, now that both
 * surfaces disclose it); `list` is the stacked form a menu wants and the one
 * that keeps working however many languages this app carries.
 *
 * `setLocale` is a Server Action the mounting surface binds — the words on
 * every page are chosen during the server render, so switching is a round
 * trip by construction and there is nothing to do optimistically.
 */
export function LanguageChoices({
  current,
  choices,
  setLocale,
  onChosen,
  layout = "row",
}: {
  current: string;
  choices: readonly LanguageChoice[];
  setLocale: (locale: string) => Promise<void>;
  /** Let a menu or dialog close itself once the choice is on its way. */
  onChosen?: () => void;
  /** `row` wraps; `list` stacks full-width rows, which is what a menu wants. */
  layout?: "row" | "list";
}) {
  const [pending, startTransition] = useTransition();
  const list = layout === "list";
  return (
    <div className={list ? "flex flex-col" : "flex flex-wrap gap-1"}>
      {choices.map((choice) => {
        const active = choice.locale === current;
        return (
          <button
            key={choice.locale}
            type="button"
            lang={choice.locale}
            // Never `disabled` for being the current one: a disabled control
            // is skipped by some screen-reader navigation modes, so the one
            // option a reader most needs announced — the language they are
            // already in — would be the one they cannot reach. Marked with
            // `aria-current` and inert on click instead.
            disabled={pending}
            aria-current={active ? "true" : undefined}
            onClick={() => {
              if (active) return;
              startTransition(async () => {
                await setLocale(choice.locale);
                onChosen?.();
              });
            }}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
              list ? "w-full justify-start gap-2" : ""
            } ${
              active
                ? "bg-surface-sunken text-foreground"
                : "text-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-60"
            }`}
          >
            {/* In a stacked list the tick is what marks the language in force
                — `aria-current` alone is invisible, and a fill that reads as
                "selected" in a row of two reads as "hovered" in a menu. The
                inert placeholder keeps every label on one left edge. */}
            {list ? (
              <span aria-hidden="true" className="w-3 shrink-0 text-primary">
                {active ? <DiveDayIcon name="check" className="size-3" strokeWidth={2.2} /> : null}
              </span>
            ) : null}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
