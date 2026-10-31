"use client";

import { useTransition } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { MENU_TICK, menuRowClass } from "@/components/ui/menu";

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
 * The choices render as menu rows (`menuRowClass`), so both disclosures share
 * their menu's corner and text edge regardless of how many languages ship.
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
    <div className="flex flex-col">
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
            className={menuRowClass(active ? "current" : "quiet")}
          >
            {/* `aria-current` is not visible; the tick marks the active row in
                the gutter every menu row reserves for consistent alignment. */}
            {active ? (
              <span aria-hidden="true" className={`${MENU_TICK} text-primary`}>
                <DiveDayIcon name="check" className="size-3" strokeWidth={2.2} />
              </span>
            ) : null}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
