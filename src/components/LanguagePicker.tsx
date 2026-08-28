"use client";

import { useEffect, useRef, useState } from "react";
import { type LanguageChoice, LanguageChoices } from "@/components/LanguageChoices";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { GroupLabel } from "@/components/ui/ledger";
import { useExitAnimation } from "@/components/useExitAnimation";

export type LanguagePickerCopy = {
  /** Names the control for a screen reader — "Change language". */
  ariaLabel: string;
  /** Heads the open panel. */
  heading: string;
};

/**
 * The public header's language control: one trigger naming the language you
 * are reading in, opening the full list.
 *
 * **Why not the row of buttons this replaces.** The header used to render one
 * `<button>` per language DiveDay carries *other than the one in force* — which
 * at two locales is exactly one button, reading "español", and that shape only
 * works at two. It is a swap, not a choice: it cannot say which language you
 * are currently in (there is no control for the one in force), and the moment a
 * third locale lands it becomes two, then three, unlabelled buttons competing
 * with the shop's own navigation for the width of a phone header — with no way
 * to tell that they are alternatives to each other rather than destinations.
 *
 * A trigger plus a panel is the same shape at two languages and at twelve. The
 * trigger carries the current language's own name for itself, so a reader who
 * cannot read a word of the header can still see which language they are in and
 * that this is where language lives; the globe says the same thing without
 * words. Inside, every language is listed — including the one in force, marked
 * `aria-current` — because "which am I in?" is a question the control should be
 * able to answer.
 *
 * Dismissal follows the staff header's identity menu exactly (Escape returns
 * focus to the trigger, a pointer down anywhere else closes): two disclosures
 * in the same position on two headers should not behave differently.
 */
export function LanguagePicker({
  current,
  currentLabel,
  choices,
  setLocale,
  copy,
}: {
  /** The language this page was written in. */
  current: string;
  /** That language's own name for itself, shown on the trigger. */
  currentLabel: string;
  /** Every language DiveDay carries, each named in itself — the current one included. */
  choices: readonly LanguageChoice[];
  setLocale: (locale: string) => Promise<void>;
  copy: LanguagePickerCopy;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 180ms matches .animate-scale-out in globals.css — the two must move together.
  const { mounted, closing } = useExitAnimation(open, 180);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={copy.ariaLabel}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
      >
        {/* The globe is the half of this control that needs no language at
            all — the reader most likely to reach for it is the one who cannot
            read the label beside it. */}
        <DiveDayIcon name="globe" className="size-4 shrink-0" strokeWidth={1.75} />
        {/* `lang` so a screen reader pronounces "Español" as Spanish rather
            than reading it through the page's own language.

            Below `sm` the globe carries the control alone and the endonym goes
            `sr-only` — it stays in the accessibility tree, so nothing is lost
            to a screen reader, and the phone's chrome bar is one fixed-height
            row that the shop's own name has first claim on (ADR
            20260827-clearwater-surface-language, decision 10). The globe is
            the half that needs no language, which is why it is the half that
            survives the squeeze. */}
        <span lang={current} className="sr-only sm:not-sr-only">
          {currentLabel}
        </span>
        <DiveDayIcon
          name="caret"
          direction="down"
          className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {mounted ? (
        <div
          className={`absolute top-full right-0 z-10 mt-1 min-w-40 rounded-xl border border-border bg-surface p-2 shadow-lg ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        >
          <GroupLabel className="px-2">{copy.heading}</GroupLabel>
          <div className="mt-1">
            <LanguageChoices
              current={current}
              choices={choices}
              setLocale={setLocale}
              onChosen={() => setOpen(false)}
              layout="list"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
