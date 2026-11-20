"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ErrorToast } from "@/components/Toast";
import { segmentClass, segmentedTrackClass } from "@/components/ui/segmented";
import type { DiveParticipation } from "@/lib/dive-participation";

export type DiveParticipationAction = (
  bookingId: string,
  participation: DiveParticipation,
) => Promise<{ ok: boolean }>;

export type DiveParticipationCopy = {
  /** "Dive 2", the group's name. */
  label: string;
  dived: string;
  satOut: string;
  error: string;
};

/**
 * **Dived or sat out, for the dive this count follows** (issue #4307): two
 * toggles on the person sheet. Neither pressed is unknown, which is where
 * every seat starts; tapping the pressed one takes it back to unknown. One
 * tap, and it writes nothing to the roll call or the head count.
 */
export function DiveParticipationControl({
  bookingId,
  participation,
  action,
  copy,
}: {
  bookingId: string;
  participation: DiveParticipation;
  action: DiveParticipationAction;
  copy: DiveParticipationCopy;
}) {
  const [shown, setShown] = useOptimistic(participation);
  const [pending, startTransition] = useTransition();
  const [failures, setFailures] = useState(0);
  const choose = (pressed: DiveParticipation) => {
    const next: DiveParticipation = shown === pressed ? "unknown" : pressed;
    startTransition(async () => {
      setShown(next);
      const result = await action(bookingId, next).catch(() => ({ ok: false }));
      if (!result.ok) setFailures((count) => count + 1);
    });
  };
  const options: ReadonlyArray<{ value: Exclude<DiveParticipation, "unknown">; label: string }> = [
    { value: "dived", label: copy.dived },
    { value: "sat_out", label: copy.satOut },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span className="text-base font-semibold">{copy.label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: a pair of toggles, not a fieldset of inputs. */}
      <div role="group" aria-label={copy.label} className={`w-fit ${segmentedTrackClass}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={shown === option.value}
            aria-busy={pending || undefined}
            disabled={pending}
            onClick={() => choose(option.value)}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-sm transition-colors focus-visible:focus-ring ${segmentClass(
              { selected: shown === option.value },
            )}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {failures > 0 ? <ErrorToast key={failures} message={copy.error} /> : null}
    </div>
  );
}
