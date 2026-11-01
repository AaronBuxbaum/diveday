"use client";

import { useState } from "react";
import {
  holdSendAction,
  type ReleasedSend,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import { type HeldTicket, SendHold } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import { rescheduleCountLine } from "./reschedule-hold-copy";

export type RescheduleHoldCopy = {
  /** Count-free progress while a reschedule notice is being sent. */
  telling: string;
  /** Locale the plural forms below are chosen in. */
  locale: string;
  /** "Told {count} divers the new time." templates, singular and other. */
  told: { one: string; other: string };
  /** "{count} divers could not be reached…" templates, singular and other. */
  someMissed: { one: string; other: string };
  notTold: string;
  tellThem: string;
  undo: string;
};

/**
 * **The divers hear that the departure moved** (ux review 2026-10-11, item 1).
 *
 * The move already held the notice (`holdRescheduleNotice`); this is the line
 * the board and the trip page draw for it under their saved notice: "Telling
 * 6 divers the new time…" with Undo, then what the send did. After an Undo the
 * row says the divers still have the old time and offers "Tell them", which
 * holds the same notice again. Neither the recipients nor the time the divers
 * were last told are on this form: the server reads both off the trip.
 */
export type RescheduleNoticeSnapshot = {
  ticket: HeldTicket;
  tripId: string;
  copy: RescheduleHoldCopy;
};

export function RescheduleHold({
  initialNotice,
}: {
  initialNotice: RescheduleNoticeSnapshot | null;
}) {
  // A successful Undo removes the row. Keep this browser's validated snapshot
  // across the action refresh; the server key resets it for another identity.
  const [notice] = useState(initialNotice);
  const [result, setResult] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  if (!notice) return null;
  const { ticket, tripId, copy } = notice;
  if (result) {
    return (
      <p role="status" className="text-sm">
        {result}
      </p>
    );
  }
  if (gone) return null;
  return (
    <SendHold<Extract<ReleasedSend, { status: "done" }>["outcome"]>
      initialTicket={ticket}
      hold={holdSendAction}
      undo={undoHeldSendAction}
      release={async (id) => {
        const released = await releaseHeldSendAction(id);
        // Already sent from another tab, or by the sweep: nothing to say here.
        if (released.status === "gone") setGone(true);
        return released;
      }}
      onOutcome={(outcome) => {
        if (outcome.kind !== "trip_rescheduled") return;
        const lines = [
          outcome.told > 0 ? rescheduleCountLine(copy.told, outcome.told, copy.locale) : null,
          outcome.failed > 0
            ? rescheduleCountLine(copy.someMissed, outcome.failed, copy.locale)
            : null,
        ].filter(Boolean);
        // Nobody left to tell by the time it drained (every seat cancelled or
        // held): nothing happened, and the row says nothing.
        if (lines.length === 0) setGone(true);
        else setResult(lines.join(" "));
      }}
      copy={{ sendingNow: copy.telling, undo: copy.undo }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="holdKind" value="trip_rescheduled" />
      <input type="hidden" name="tripId" value={tripId} />
      <span className="text-sm">{copy.notTold}</span>
      <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
        {copy.tellThem}
      </button>
    </SendHold>
  );
}
