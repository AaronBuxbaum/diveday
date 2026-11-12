"use client";

import { useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";

/**
 * The eyebrow's rung, spelled here rather than imported from `ShopPageHeader`:
 * this component rides in the shared staff and public shells, and importing
 * that module would pull the whole header into the shared first-load chunk.
 */
const EYEBROW_CLASS =
  "text-[0.6875rem] leading-normal font-bold tracking-[0.16em] uppercase text-primary";

export interface DemoStartCopy {
  startTitle: string;
  dismissStarts: string;
}

/**
 * Dismissal is stored on the demo shop (a demo is minted per visitor), so it
 * holds across tabs, devices and role switches.
 */
export function DemoStartStrip({
  copy,
  choices,
  pending,
  onStart,
  dismissed: dismissedOnShop,
  onDismiss,
}: {
  copy: DemoStartCopy;
  choices: readonly { id: string; role: string; label: string }[];
  pending: boolean;
  onStart: (role: string, start: string) => void;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || dismissedOnShop) return null;
  return (
    <section
      aria-label={copy.startTitle}
      aria-busy={pending || undefined}
      className="mt-3 rounded-inset border border-border bg-surface-sunken px-1 py-3 sm:px-4"
    >
      <div className="flex items-center justify-between gap-1 sm:gap-3">
        <h2 className={EYEBROW_CLASS}>{copy.startTitle}</h2>
        <button
          type="button"
          aria-label={copy.dismissStarts}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
          onClick={() => {
            setDismissed(true);
            onDismiss();
          }}
        >
          <DiveDayIcon name="close" className="size-4" />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={pending}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "max-w-full text-start",
            })}
            onClick={() => onStart(choice.role, choice.id)}
          >
            {choice.label}
            <DiveDayIcon name="arrow-right" className="size-3.5 text-primary" />
          </button>
        ))}
      </div>
    </section>
  );
}
