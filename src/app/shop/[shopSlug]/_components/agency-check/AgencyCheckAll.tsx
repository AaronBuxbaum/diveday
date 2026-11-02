// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import type { CheckableAgency } from "@/lib/agency-check";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import {
  type AgencyCheckQueueState,
  agencyCheckCardsToRun,
  useAgencyCheckHost,
} from "./AgencyCheckHost";
import type { AgencyCheckAllCopy } from "./agency-check-copy";

/** Fewer than this and the rows' own buttons are the whole job. */
const CHECK_ALL_FROM = 2;

/**
 * **"Check all 9 cards with their agencies"**, for one departure (H-20261008-cert-check-extension).
 *
 * Drawn only with the DiveDay browser extension, and only when the departure
 * holds at least two cards it can check that this page has not already
 * settled. The cards are this departure's and no one else's, handed down from
 * the page; the run goes one card at a time with a pause between
 * (`runAgencyCheckQueue`), each row settling as its own check does. It skips
 * one diver the agency's page does not show, stops on two in a row or on a
 * signed-out agency, leaves an agency's other cards once its page asks
 * whether the staffer is human or has changed, and has a Stop of its own. What it says while it runs and
 * once it ends is one quiet line, read out as it changes. It has no Undo of
 * its own: each card it certified keeps its Undo on its row.
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
  const toRun = agencyCheckCardsToRun(cards, host.states);
  if (queue.phase === "idle" && toRun.length < CHECK_ALL_FROM) return null;

  const status =
    queue.phase === "running"
      ? fill(copy.progress, { done: queue.done, total: queue.total })
      : queue.phase === "ended"
        ? endedText(queue, copy, (agency) => host.copies[agency]?.agency ?? "")
        : null;
  const startLabel = copy.start[toRun.length] ?? copy.start.at(-1) ?? "";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 print:hidden">
      {queue.phase === "running" ? (
        <button
          type="button"
          onClick={host.stopAll}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.stop}
        </button>
      ) : toRun.length >= CHECK_ALL_FROM ? (
        <button
          type="button"
          onClick={() => host.runAll(cards)}
          disabled={host.busy}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {startLabel}
        </button>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${queue.phase === "ended" && (queue.stopped || queue.left.some((each) => each.skipped > 0)) ? "text-warning-strong" : "text-muted"}`}
      >
        {status}
      </p>
    </div>
  );
}

/** What an ended run says: where it stopped and why, or what it came to, and which agencies' cards it left. */
function endedText(
  ended: Extract<AgencyCheckQueueState, { phase: "ended" }>,
  copy: AgencyCheckAllCopy,
  agencyName: (agency: CheckableAgency) => string,
): string {
  // Each agency whose other cards the run left, once, after what it came to.
  const left = ended.left
    .filter((each) => each.skipped > 0)
    .map((each) => fill(copy.left, { agency: agencyName(each.card.agency) }));
  return [counted(ended, copy, agencyName), ...left].join(" ");
}

/** Where an ended run stopped and why, or what it came to. */
function counted(
  ended: Extract<AgencyCheckQueueState, { phase: "ended" }>,
  copy: AgencyCheckAllCopy,
  agencyName: (agency: CheckableAgency) => string,
): string {
  if (ended.stopped) {
    const template =
      ended.stopped.outcome === "signed_out"
        ? copy.stoppedSignedOut
        : ended.stopped.outcome === "transport"
          ? copy.stoppedTransport
          : copy.stopped;
    return fill(template, {
      name: ended.stopped.card.fullName,
      agency: agencyName(ended.stopped.card.agency),
    });
  }
  const counts = fill(ended.cancelled ? copy.cancelled : copy.finished, {
    checked: ended.checked,
    certified: ended.certified,
  });
  return ended.confirmed > 0
    ? `${counts} ${fill(copy.confirmed, { confirmed: ended.confirmed })}`
    : counts;
}
