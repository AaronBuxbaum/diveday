"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/ledger";
import type { TripStage } from "@/lib/trip-stages";
import type { PreDepartureCheckResult } from "../actions";

/**
 * **Where the boat is, in the crew's own word** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * Five buttons at the top of the manifest. Each tap appends; nothing here
 * edits or clears, so a crew that taps the wrong word taps the right one and
 * the newest wins.
 *
 * The manifest is a safety surface, so this carries no drawing, no coral and
 * no motion — the boat that drifts on the shop home and the storefront is
 * deliberately absent here, and `illustration.test.ts` refuses a drawing
 * import under any path containing "manifest" so the ban is structural rather
 * than remembered.
 */
export type StageStripAction = (
  prev: PreDepartureCheckResult,
  formData: FormData,
) => Promise<PreDepartureCheckResult>;

export type StageStripCopy = {
  legend: string;
  errorRefusal: string;
  /** The five taps, in the order the crew works through them. */
  taps: { stage: TripStage; label: string }[];
  /** "Keiko Tanaka · 7:04 AM", composed server-side, or undefined if nobody has said anything. */
  recordedLine?: string;
};

export function StageStrip({
  action,
  copy,
  current,
}: {
  action: StageStripAction;
  copy: StageStripCopy;
  current: TripStage | null;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  return (
    <section aria-label={copy.legend} className="mt-4">
      <h2 className={groupLabelClass()}>{copy.legend}</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {copy.taps.map((tap) => (
          <form action={formAction} key={tap.stage}>
            <input type="hidden" name="stage" value={tap.stage} />
            <button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              aria-pressed={current === tap.stage}
              className={buttonClass({
                variant: current === tap.stage ? "primary" : "secondary",
                size: "sm",
              })}
            >
              {tap.label}
            </button>
          </form>
        ))}
      </div>
      {copy.recordedLine ? (
        <p className="mt-2 text-sm text-muted tabular-nums">{copy.recordedLine}</p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
    </section>
  );
}
