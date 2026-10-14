// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import { useAgencyCheckHost } from "./AgencyCheckHost";
import type { AgencyCheckAllCopy } from "./agency-check-copy";

/** Fewer than this and the rows' own buttons are the whole job. */
const CHECK_ALL_FROM = 2;

/**
 * **"Check all 9 with their agencies"**, for one departure (H-105).
 *
 * Drawn only with the DiveDay browser extension, and only when the departure
 * holds at least two cards it can check. The cards are this departure's and no
 * one else's, handed down from the page; the run goes one card at a time with
 * a pause between (`runAgencyCheckQueue`), each row settling as its own check
 * does, and stops on the first agency page it cannot read. What it says while
 * it runs and once it ends is one quiet line, read out as it changes. It has
 * no Undo of its own: each card it certified keeps its Undo on its row.
 */
export function AgencyCheckAll({
  cards,
  copy,
}: {
  /** The departure's checkable cards, in roster order (`listAgencyCheckableCards`). */
  cards: readonly AgencyCheckableCard[];
  copy: AgencyCheckAllCopy;
}) {
  const host = useAgencyCheckHost();
  if (!host?.hasExtension) return null;
  const { queue } = host;
  if (queue.phase === "idle" && cards.length < CHECK_ALL_FROM) return null;

  const status =
    queue.phase === "running"
      ? fill(copy.progress, { done: queue.done, total: queue.total })
      : queue.phase === "ended" && queue.stopped
        ? fill(queue.stopped.outcome === "signed_out" ? copy.stoppedSignedOut : copy.stopped, {
            name: queue.stopped.card.fullName,
            agency: host.copies[queue.stopped.card.agency]?.agency ?? "",
          })
        : queue.phase === "ended" && !queue.cancelled
          ? fill(copy.finished, { checked: queue.checked, certified: queue.certified })
          : null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 print:hidden">
      {cards.length >= CHECK_ALL_FROM && queue.phase !== "running" ? (
        <button
          type="button"
          onClick={() => host.runAll(cards)}
          disabled={host.busy}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.start}
        </button>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${queue.phase === "ended" && queue.stopped ? "text-warning-strong" : "text-muted"}`}
      >
        {status}
      </p>
    </div>
  );
}
