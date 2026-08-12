"use client";

import { useTransition } from "react";

/** One language on offer: its tag, and its own name for itself. */
export type LanguageChoice = { locale: string; label: string };

/**
 * The languages DiveDay carries, as a row of buttons — each one its own
 * language's name for itself, because the reader most likely to need this
 * control is the one who cannot read the label above it.
 *
 * A `<button>` per language rather than a `<select>`: two options is not a
 * list to open, and a select would need its own confirm step or an onChange
 * that submits, which is the shape screen-reader users are most often warned
 * about. The one already in force is marked `aria-current` and reads as
 * selected rather than as somewhere to go.
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
}: {
  current: string;
  choices: readonly LanguageChoice[];
  setLocale: (locale: string) => Promise<void>;
  /** Let a menu or dialog close itself once the choice is on its way. */
  onChosen?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-1">
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
              active
                ? "bg-surface-sunken text-foreground"
                : "text-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-60"
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
