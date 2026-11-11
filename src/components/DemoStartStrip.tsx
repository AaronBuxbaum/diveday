"use client";

import { useState, useSyncExternalStore } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";

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
      className="mt-3 border-t border-accent/30 pt-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{copy.startTitle}</h2>
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
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={pending}
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              className: "text-start",
            })}
            onClick={() => onStart(choice.role, choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}
