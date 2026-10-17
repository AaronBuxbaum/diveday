"use client";

import { useActionState, useEffect } from "react";
import { ConnectivityStatus, type ConnectivityStatusCopy } from "@/components/ConnectivityStatus";
import {
  refusePress,
  wasMultiTouch,
  watchRollCallTouches,
} from "@/components/roll-call-touch-guard";
import { buttonClass } from "@/components/ui/button";
import type { MissingReportState } from "../../incidents/actions";

export type MissingReportAction = (
  previous: MissingReportState,
  formData: FormData,
) => Promise<MissingReportState>;

/**
 * **"Start a missing diver report"** in a person sheet whose row is marked not
 * back aboard (safety sheet 2026-10-15, item 2): a diver's seat or a crew
 * member, posted as the hidden field the action parses.
 *
 * Three things the plain form it replaces did not do (domain review
 * 2026-10-16): every refusal is a sentence under the button rather than the
 * manifest swapped for an error page; a press made under a palm or spray does
 * not submit (`roll-call-touch-guard`, the same rule as every roll-call
 * control on this page); and the report it opens carries the way back to this
 * checkpoint.
 *
 * The caller keys it on the checkpoint, as `RollCallButton` asks, so a refusal
 * read at one checkpoint never stands under another.
 */
export function MissingReportButton({
  action,
  subject,
  checkpoint,
  label,
  pendingLabel,
  ariaLabel,
  variant = "secondary",
  offline,
}: {
  action: MissingReportAction;
  subject: { field: "bookingId" | "personId"; id: string };
  checkpoint: string;
  label: string;
  pendingLabel: string;
  ariaLabel: string;
  /** `danger` for "Missing diver, alert owners now", the louder of the two (issue #2694). */
  variant?: "secondary" | "danger";
  /**
   * For the owners' alert (review 2026-10-17): the line shown while this
   * device has no signal, and the sentence for a request that never reached
   * the server, so a dead connection reads as "call them", never as silence.
   */
  offline?: { label: string; copy: ConnectivityStatusCopy; failed: string };
}) {
  const [state, formAction, isPending] = useActionState<MissingReportState, FormData>(
    offline
      ? async (previous, formData) => {
          try {
            return await action(previous, formData);
          } catch {
            return { message: offline.failed };
          }
        }
      : action,
    null,
  );
  useEffect(() => watchRollCallTouches(), []);
  return (
    <form action={formAction} className="mt-3 print:hidden">
      {offline ? (
        <ConnectivityStatus
          onlyWhenOffline
          offlineLabel={offline.label}
          copy={offline.copy}
          className="mb-2"
        />
      ) : null}
      <input type="hidden" name={subject.field} value={subject.id} />
      <input type="hidden" name="checkpoint" value={checkpoint} />
      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        aria-label={isPending ? undefined : ariaLabel}
        // Spray and a wet palm land as several contacts at once; a press made
        // under more than one does not submit, and says so on this control.
        onClick={(event) => {
          if (!wasMultiTouch()) return;
          event.preventDefault();
          refusePress(event.currentTarget);
        }}
        className={buttonClass({ variant })}
      >
        {isPending ? pendingLabel : label}
      </button>
      {state ? (
        <p
          role={state.tone === "success" ? "status" : "alert"}
          className={`mt-2 text-sm font-medium ${state.tone === "success" ? "text-success-strong" : "text-danger"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
