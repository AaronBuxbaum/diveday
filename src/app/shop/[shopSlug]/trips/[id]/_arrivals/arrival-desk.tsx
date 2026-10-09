import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FIGURE_HERO_CLASS } from "@/components/ui/typography";
import { type CheckInQueueRow, listCheckInQueue } from "@/db/check-in";
import type { AppDb } from "@/db/client";
import { noShowSalvage } from "@/db/no-show";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { welcomeCueText } from "@/i18n/welcome-cue-labels";
import { counterIsClear, counterTally, isNoShowAtCounter } from "@/lib/check-in";
import { formatTime, formatWeekdayTime } from "@/lib/format";
import { type NoShowClaim, noShowClaim, noShowGate } from "@/lib/no-show";
import { arrivalsWindow } from "@/lib/operational-window";
import { paperPassPath } from "@/lib/print-sheets";
import { hasSailed } from "@/lib/trips";
import { welcomeCueFor } from "@/lib/welcome-cue";
import type { RosterArrival } from "../_components/RosterSection";
import { ArrivalTap } from "./ArrivalTap";
import { checkInAction, markNoShowAction, undoCheckInAction, undoNoShowAction } from "./actions";
import { CounterInstrument } from "./CounterInstrument";
import { NoShowSalvage, NoShowScript } from "./NoShowScript";
import { RowActionForm } from "./RowActionForm";
import { noShowSalvageCopy } from "./salvage-copy";

/** What the Divers tab adds while a departure's arrivals are open. */
export type ArrivalDesk = {
  /** The count, the taps and the groups the roster draws (`RosterSection`'s `arrival`). */
  arrival: RosterArrival;
  /**
   * Whether the boat can still seat a walk-in. The door itself is the add-a-
   * diver search's empty result (UX audit 2026-10-07, item 24), not a row of
   * its own.
   */
  walkInOpen: boolean;
};

/**
 * Whether a departure's arrivals are open now: scheduled, and inside the
 * counter's window (`arrivalsWindow`). A boat next week or one long gone is the
 * roster alone.
 */
export function deskIsOpen(trip: { status: string; startsAt: Date }, now: Date): boolean {
  const window = arrivalsWindow(now);
  return trip.status === "scheduled" && trip.startsAt >= window.from && trip.startsAt <= window.to;
}

/**
 * **The desk, composed for the Divers tab** (owner, 2026-10-05). The counter
 * used to be a tab of its own that listed the same divers as the roster, with
 * the same blockers and the same fixes; arrival is a state of the roster now,
 * and this is the part of the old counter that the roster does not already
 * have: the count, the check-in tap and its undo, "Not here" and the released
 * seat's next step, the paper pass, and whether a walk-in can still be seated.
 *
 * Every fix for a blocked diver — the waiver, the paper release, the identity
 * confirm, payment — is the roster row's own, so a blocked row gets no
 * check-in tap: readiness is the gate. It still gets "Not here" and, once
 * arrived, its undo.
 *
 * Returns `null` outside the arrivals window (`deskIsOpen`).
 */
export async function buildArrivalDesk({
  db,
  shopId,
  shopSlug,
  tripId,
  trip,
  now,
  locale,
  timeZone,
  t,
}: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  tripId: string;
  trip: { status: string; startsAt: Date };
  now: Date;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}): Promise<ArrivalDesk | null> {
  if (!deskIsOpen(trip, now)) return null;
  const [rows, welcomeInputs] = await Promise.all([
    listCheckInQueue(db, shopId, { now, tripId }),
    welcomeCueInputsByBooking(db, shopId, tripId, now),
  ]);

  const checkIn = checkInAction.bind(null, shopSlug, tripId);
  const undo = undoCheckInAction.bind(null, shopSlug, tripId);
  const markNoShow = markNoShowAction.bind(null, shopSlug, tripId);
  const undoNoShow = undoNoShowAction.bind(null, shopSlug, tripId);

  // **"Not here" opens when the boat leaves without them**, and says something
  // different once it is gone. `markBookingNoShow` runs the same gate again
  // against locked rows, so this decides only whether the door is drawn and
  // which script it carries (#1209).
  const noShowClaimFor = (row: CheckInQueueRow): NoShowClaim | null =>
    noShowGate({
      bookingStatus: row.bookingStatus,
      onTheWater: row.onTheWater,
      tripStatus: "scheduled",
      startsAt: row.startsAt,
      now,
    }) === "eligible"
      ? noShowClaim({ startsAt: row.startsAt, now })
      : null;

  // One salvage read, and only when the boat actually holds a released seat.
  const salvage = rows.some(isNoShowAtCounter)
    ? await noShowSalvage(db, { shopId, tripId, now })
    : null;

  const controls = new Map<string, ReactNode>();
  const below = new Map<string, ReactNode>();
  for (const row of rows) {
    const ready = row.readiness.status === "ready";
    if (row.bookingStatus === "no_show") {
      // **The released seat, and what to do with it.** The group says "Not
      // here"; the row's one act is walking it back for the diver who turns up
      // as the lines come off.
      controls.set(
        row.bookingId,
        <RowActionForm action={undoNoShow} sendFailedLabel={t("checkIn.sendFailedButton")}>
          <input type="hidden" name="bookingId" value={row.bookingId} />
          <SubmitButton
            pendingLabel={t("checkIn.noShow.undoing")}
            ariaLabel={t("checkIn.noShow.undoAriaLabel", { name: row.personName })}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {t("checkIn.noShow.undo")}
          </SubmitButton>
        </RowActionForm>,
      );
      if (salvage) {
        below.set(
          row.bookingId,
          <NoShowSalvage
            copy={noShowSalvageCopy({
              t,
              offer: salvage,
              shopSlug,
              tripId,
              diver: { id: row.personId, name: row.personName },
              formatWhen: (startsAt) => formatWeekdayTime(startsAt, locale, timeZone),
            })}
          />,
        );
      }
      continue;
    }
    if (row.bookingStatus === "checked_in") {
      // **Undo on every arrived row, blocked or not** (dive-domain review
      // 2026-10-05): a diver who went blocked after arriving still has to be
      // walked back, and taking a state away can never add risk.
      controls.set(
        row.bookingId,
        <span className="flex items-center gap-3">
          {/* **The paper pass, on the arrived and cleared row and nowhere
              else** (ADR 20260908-one-hand, decision 6, lever X): for the
              diver at the desk with no phone, the moment just after their name
              is ticked. Never a pass for a seat readiness refuses. */}
          {ready ? (
            <Link
              href={paperPassPath(shopSlug, row.bookingId)}
              className={buttonClass({ variant: "link", size: "sm", flush: true })}
            >
              {t("print.counter.passDoor")}
            </Link>
          ) : null}
          <ArrivalTap
            action={undo}
            bookingId={row.bookingId}
            checkedIn
            label={t("checkIn.row.arrived")}
            pendingLabel={t("checkIn.undoing")}
            ariaLabel={t("checkIn.undoAriaLabel", { name: row.personName })}
            sendFailedLabel={t("checkIn.sendFailed")}
          />
        </span>,
      );
      continue;
    }
    // Readiness is the gate: a tap beside the reasons would be an act the
    // server refuses.
    if (ready) {
      controls.set(
        row.bookingId,
        <ArrivalTap
          action={checkIn}
          bookingId={row.bookingId}
          checkedIn={false}
          label={t("checkIn.checkInButton")}
          pendingLabel={t("checkIn.checkingIn")}
          ariaLabel={t("checkIn.checkInAriaLabel", { name: row.personName })}
          sendFailedLabel={t("checkIn.sendFailed")}
        />,
      );
    }
    const claim = noShowClaimFor(row);
    if (claim) {
      // **"Not here" on a blocked row too** (dive-domain review 2026-10-05):
      // the diver who never signed is the commonest no-show, and a door that
      // opened only once the release was on file would invite somebody to
      // record a release for a person who is not there just to free the seat.
      //
      // **Two scripts, because the tap is two different claims**: while the
      // boat is still there it is about a seat; once it has gone, the same tap
      // says this person did not dive.
      below.set(
        row.bookingId,
        <NoShowScript
          action={markNoShow}
          bookingId={row.bookingId}
          // One door and one confirm either side of the departure ("Not
          // here"): "did not dive" also describes a diver who sat a dive out
          // aboard, whom this tap refuses (dive-domain review 2026-10-06).
          // What differs is the sentence saying what the tap records.
          copy={{
            door: t("checkIn.noShow.door"),
            consequence:
              claim === "did_not_dive"
                ? t("checkIn.noShow.sailedConsequence")
                : t("checkIn.noShow.consequence"),
            confirm: t("checkIn.noShow.confirm"),
            confirming: t("checkIn.noShow.confirming"),
            confirmAriaLabel: t("checkIn.noShow.confirmAriaLabel", { name: row.personName }),
            sendFailed: t("checkIn.sendFailedButton"),
          }}
        />,
      );
    }
  }

  // **"Running late, said 7:42"** (J3): the diver's own word, on a seat still
  // to arrive, ahead of everything else under the name — it is the answer to
  // the question the desk is asking about that row. `listCheckInQueue` has
  // already dropped it from an arrived or released seat.
  for (const row of rows) {
    if (!row.runningLateAt) continue;
    const line = (
      <p key="late" className="mt-1 text-sm font-medium text-warning-strong">
        {t("checkIn.row.runningLate", {
          time: formatTime(row.runningLateAt, locale, timeZone),
        })}
      </p>
    );
    const existing = below.get(row.bookingId);
    below.set(
      row.bookingId,
      existing ? (
        <>
          {line}
          {existing}
        </>
      ) : (
        line
      ),
    );
  }

  // **The welcome word, at the counter** (UX audit 2026-10-07, item 46): the
  // same consented cue the manifest wears under a name and Today's "Say hello"
  // row names, on the row the desk is looking at when the diver walks up.
  // `welcomeCueFor` answers nothing without the diver's own consent stamp, and
  // nothing an hour after the boat is home. What a diver said they came for
  // stays a count (D12): it names nobody, which is what lets it be asked.
  for (const row of rows) {
    if (row.bookingStatus === "no_show") continue;
    const inputs = welcomeInputs.get(row.bookingId);
    const cue = inputs ? welcomeCueFor({ ...inputs, tripEndsAt: row.endsAt, now }) : null;
    if (!cue) continue;
    const line = (
      <p key="welcome" className="mt-1 text-sm text-muted">
        {welcomeCueText(t, cue)}
      </p>
    );
    const existing = below.get(row.bookingId);
    below.set(
      row.bookingId,
      existing ? (
        <>
          {line}
          {existing}
        </>
      ) : (
        line
      ),
    );
  }

  // **The figure and its remainders** read off one tally
  // (`src/lib/check-in.ts`), so nobody has to subtract to check. "Here" is
  // arrival — checked in and cleared to board. Whether the desk is *finished*
  // is the roster's question (a contact number, a balance), so the roster
  // says whether the cleared line may show.
  const { here, expected, cantBoard, toCome, notHere } = counterTally(rows);
  const remainder =
    [
      toCome > 0 ? t("checkIn.instrument.toCome", { count: toCome }) : null,
      cantBoard > 0 ? t("checkIn.instrument.cantBoard", { count: cantBoard }) : null,
      notHere > 0 ? t("checkIn.instrument.notHere", { count: notHere }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  const instrument =
    rows.length > 0
      ? (deskWorkOpen: boolean) => (
          <CounterInstrument
            here={here}
            expected={expected}
            cantBoard={cantBoard}
            cleared={counterIsClear(rows) && !deskWorkOpen}
            remainder={remainder}
            clearedLabel={t("checkIn.clearedTitle")}
            figure={t.rich("checkIn.instrument.hereOf", {
              here,
              expected,
              figure: (chunks) => (
                <span className={`${FIGURE_HERO_CLASS} text-foreground`}>{chunks}</span>
              ),
            })}
          />
        )
      : undefined;

  const boarded = new Set(rows.filter((row) => row.boarded).map((row) => row.bookingId));

  // A walk-in can only be seated on a boat that has not left: the seat action
  // refuses one that is underway, so the door is not offered there.
  const walkInOpen = !hasSailed(trip.startsAt, now);

  return { arrival: { instrument, controls, below, boarded }, walkInOpen };
}
