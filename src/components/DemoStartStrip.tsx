"use client";

import { useState, useSyncExternalStore } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";

/**
 * The eyebrow's rung, spelled here rather than imported from `ShopPageHeader`:
 * this component rides in the shared staff and public shells, and importing
 * that module would pull the whole header into the shared first-load chunk.
 */
const EYEBROW_CLASS = "text-[11px] leading-4 font-bold tracking-[0.16em] uppercase text-primary";

export interface DemoStartCopy {
  startTitle: string;
  dismissStarts: string;
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Dismissal lasts for this tab's demo session, not the next shop a visitor tries. */
export function DemoStartStrip({
  shopSlug,
  copy,
  choices,
  pending,
  onStart,
}: {
  shopSlug: string;
  copy: DemoStartCopy;
  choices: readonly { id: string; role: string; label: string }[];
  pending: boolean;
  onStart: (role: string, start: string) => void;
}) {
  const key = `diveday-demo-starts:${shopSlug}`;
  const [dismissed, setDismissed] = useState(false);
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(key) === "dismissed";
      } catch {
        return false;
      }
    },
    () => false,
  );
  if (dismissed || stored) return null;
  return (
    <section
      aria-label={copy.startTitle}
      aria-busy={pending || undefined}
      className="mt-3 rounded-inset border border-border bg-surface-sunken px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className={EYEBROW_CLASS}>{copy.startTitle}</h2>
        <button
          type="button"
          aria-label={copy.dismissStarts}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(key, "dismissed");
            } catch {
              /* This view still dismisses when storage is unavailable. */
            }
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
              className: "text-start",
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
