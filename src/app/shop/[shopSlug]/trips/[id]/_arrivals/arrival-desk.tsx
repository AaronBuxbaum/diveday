import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FIGURE_HERO_CLASS } from "@/components/ui/typography";
import { type CheckInQueueRow, listCheckInQueue } from "@/db/check-in";
import type { AppDb } from "@/db/client";
import { openLostItemsByPerson } from "@/db/lost-items";
import { noShowSalvage } from "@/db/no-show";
import { listCertificationSummaries } from "@/db/self-declared-cards";
import { partyLeadBookingIds } from "@/db/turn-away";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import { foundItemsText } from "@/i18n/lost-item-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  welcomeCueText,
  welcomeDockLine,
  welcomeDockLineUnchecked,
} from "@/i18n/welcome-cue-labels";
import {
  counterIsClear,
  counterTally,
  isNoShowAtCounter,
  isTurnedAwayAtCounter,
} from "@/lib/check-in";
import { formatTime, formatWeekdayTime } from "@/lib/format";
import { type NoShowClaim, noShowClaim, noShowGate } from "@/lib/no-show";
import { arrivalsWindow, walkInDoorOpen } from "@/lib/operational-window";
import { paperPassPath } from "@/lib/print-sheets";
import { turnAwayOffer } from "@/lib/turn-away";
import { welcomeCueFor } from "@/lib/welcome-cue";
import type { RosterArrival } from "../_components/RosterSection";
import { ArrivalTap } from "./ArrivalTap";
import {
  checkInAction,
  markNoShowAction,
  offerAnotherDayAction,
  turnAwayAction,
  undoCheckInAction,
  undoNoShowAction,
} from "./actions";
import { CounterInstrument } from "./CounterInstrument";
import { NoShowSalvage, NoShowScript } from "./NoShowScript";
import { RowActionForm } from "./RowActionForm";
import { noShowSalvageCopy } from "./salvage-copy";
import { TurnAwayDoor, TurnAwayScript } from "./TurnAwayScript";

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
  const offerAnotherDay = offerAnotherDayAction.bind(null, shopSlug, tripId);
  const turnAway = turnAwayAction.bind(null, shopSlug, tripId);

  const turnAwayFor = (row: CheckInQueueRow) => turnAwayDoor({ row, now, t, action: turnAway });

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

  // One salvage read for every released seat, and none when the boat holds
  // none: the board is read once, and the days offered to each are the ones
  // *that* diver could book (F1, layer 8; code review 2026-10-13, item 13).
  const salvageFor = await noShowSalvage(db, {
    shopId,
    tripId,
    personIds: rows.filter(isNoShowAtCounter).map((row) => row.personId),
    now,
  });
  // A party's lead cannot be moved (`moveBooking`'s `leads_party`), so a
  // turned-away lead's one money door is Remove (dde-3 #7).
  const partyLeads = await partyLeadBookingIds(
    db,
    shopId,
    rows.filter(isTurnedAwayAtCounter).map((row) => row.bookingId),
  );

  const controls = new Map<string, ReactNode>();
  const below = new Map<string, ReactNode>();
  for (const row of rows) {
    const ready = row.readiness.status === "ready";
    if (row.bookingStatus === "no_show") {
      // A diver the desk turned away was seen ashore: from the boat's start
      // their seat neither comes back nor moves (`undoBookingNoShow`'s
      // `turned_away_departed`, `moveBooking`'s `departed`; dde-3 #2, #4+#5).
      const turnedAwayAfterStart =
        row.turnedAwayAt !== null && now.getTime() >= row.startsAt.getTime();
      // **The released seat, and what to do with it.** The group says "Not
      // here"; the row's one act is walking it back for the diver who turns up
      // as the lines come off.
      if (!turnedAwayAfterStart) {
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
      }
      // **Turned away says so, in its own words** (H-135): the desk saw this
      // diver and refused them, which is not "did not arrive". The reason is
      // the category alone.
      const turnedAway = isTurnedAwayAtCounter(row) ? (
        <p key="turned-away" className="mt-1 text-sm font-medium text-foreground">
          {t("checkIn.turnAway.line", { reason: row.turnedAwayReason ?? "unstated" })}
        </p>
      ) : null;
      const salvage = salvageFor.get(row.personId);
      const panel = salvage ? (
        <NoShowSalvage
          key="salvage"
          offerAction={offerAnotherDay}
          copy={noShowSalvageCopy({
            t,
            offer: salvage,
            shopSlug,
            tripId,
            diver: { id: row.personId, name: row.personName, bookingId: row.bookingId },
            formatWhen: (startsAt) => formatWeekdayTime(startsAt, locale, timeZone),
            turnedAway: turnedAway !== null,
            moveClosed: turnedAwayAfterStart || partyLeads.has(row.bookingId),
          })}
        />
      ) : null;
      if (turnedAway || panel) {
        below.set(
          row.bookingId,
          <>
            {turnedAway}
            {panel}
          </>,
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
        <ArrivalTap
          action={undo}
          bookingId={row.bookingId}
          checkedIn
          label={t("checkIn.row.arrived")}
          pendingLabel={t("checkIn.undoing")}
          ariaLabel={t("checkIn.undoAriaLabel", { name: row.personName })}
          sendFailedLabel={t("checkIn.sendFailed")}
        />,
      );
      // **The paper pass, on the arrived and cleared row and nowhere else**
      // (ADR 20260908-one-hand, decision 6, lever X): for the diver at the
      // desk with no phone, the moment just after their name is ticked. Never
      // a pass for a seat readiness refuses. Under the name, not beside
      // "Checked in": two controls in the row's end broke "Tom Okafor" over
      // two lines at 390 (fourth review, item 48).
      if (ready) {
        below.set(
          row.bookingId,
          <Link
            href={paperPassPath(shopSlug, row.bookingId)}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("print.counter.passDoor")}
          </Link>,
        );
      } else {
        // A diver who arrived and has since gone blocked can still be sent
        // home, until the boat leaves with them.
        placeTurnAway(turnAwayFor(row), row.bookingId, { controls, below });
      }
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
    // The door beside the Blocked pill, its confirm at the row's foot (A08).
    const turnAway = ready ? null : turnAwayFor(row);
    placeTurnAway(turnAway, row.bookingId, { controls, below });
    const turnAwayDoor = turnAway?.panel ?? null;
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
        <>
          {turnAwayDoor}
          <NoShowScript
            key="no-show"
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
          />
        </>,
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
  //
  // Under a first-timer's cue, the dock line (UX review 2026-10-10, item 36):
  // the name to say and the card they hold. One certification read, and only
  // for the consented first-timers on this boat, which on most mornings is
  // nobody and no query.
  const cues = new Map(
    rows.flatMap((row) => {
      if (row.bookingStatus === "no_show") return [];
      const inputs = welcomeInputs.get(row.bookingId);
      const cue = inputs ? welcomeCueFor({ ...inputs, tripEndsAt: row.endsAt, now }) : null;
      return cue ? [[row.bookingId, cue] as const] : [];
    }),
  );
  const firstTimerIds = rows
    .filter((row) => cues.get(row.bookingId)?.kind === "first_trip")
    .map((row) => row.personId);
  const cards = await listCertificationSummaries(db, shopId, firstTimerIds);
  for (const row of rows) {
    const cue = cues.get(row.bookingId);
    if (!cue) continue;
    const line = (
      <div key="welcome" className="mt-1 text-sm text-muted">
        <p>{welcomeCueText(t, cue, locale)}</p>
        {cue.kind === "first_trip" ? (
          // A card nobody has verified wears the warning tone the phrase
          // wears everywhere else (`certificationSummaryUnchecked`).
          <p
            className={
              welcomeDockLineUnchecked(cards.get(row.personId) ?? null)
                ? "text-warning-strong"
                : undefined
            }
          >
            {welcomeDockLine(t, {
              personName: row.personName,
              certification: cards.get(row.personId) ?? null,
              hello: welcomeInputs.get(row.bookingId)?.hello ?? null,
            })}
          </p>
        ) : null}
      </div>
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

  // **Something of theirs is in lost and found** (fifth loop, item 7): the
  // crew wrote it down against their seat on an earlier boat, and today they
  // are at the counter. Last under the name: it is a hand-over, not a gate.
  const found = await openLostItemsByPerson(
    db,
    shopId,
    rows.map((row) => row.personId),
  );
  for (const row of rows) {
    const items = found.get(row.personId);
    if (!items || items.length === 0) continue;
    const line = (
      <p key="found" className="mt-1 text-sm" data-testid="found-item-line">
        {foundItemsText(t, items)}
      </p>
    );
    const existing = below.get(row.bookingId);
    below.set(
      row.bookingId,
      existing ? (
        <>
          {existing}
          {line}
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
  const { here, expected, cantBoard, toCome, notHere, turnedAway } = counterTally(rows);
  const remainder =
    [
      toCome > 0 ? t("checkIn.instrument.toCome", { count: toCome }) : null,
      cantBoard > 0 ? t("checkIn.instrument.cantBoard", { count: cantBoard }) : null,
      notHere > 0 ? t("checkIn.instrument.notHere", { count: notHere }) : null,
      turnedAway > 0 ? t("checkIn.instrument.turnedAway", { count: turnedAway }) : null,
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

  // The seat action asks the same question again, so a boat that has left (or
  // is out of the counter's reach) is not offered the door.
  const walkInOpen = walkInDoorOpen(trip.startsAt, now);

  return { arrival: { instrument, controls, below, boarded }, walkInOpen };
}

/**
 * **"Turned away" on a blocked row, before the boat leaves too** (H-135: any
 * active staff, blocked rows only). The door and the writer share one
 * predicate (`turnAwayOffer`, the gate `turnBookingAway` runs again under the
 * seat's lock), so the desk never draws a door the writer refuses: none on the
 * water, none on an arrived diver once the boat has sailed, and on a held seat
 * only the seat's own reasons (layer 3 review, 2026-10-16).
 */
function turnAwayDoor({
  row,
  now,
  t,
  action,
}: {
  row: CheckInQueueRow;
  now: Date;
  t: StaffTranslator;
  action: (formData: FormData) => Promise<void>;
}): { door: ReactNode; panel: ReactNode } | null {
  const reasons = turnAwayOffer({
    bookingStatus: row.bookingStatus,
    onTheWater: row.onTheWater,
    tripStatus: "scheduled",
    startsAt: row.startsAt,
    now,
    readiness: row.readiness,
  });
  if (reasons.length === 0) return null;
  const door = (
    <TurnAwayDoor
      key="turn-away-door"
      bookingId={row.bookingId}
      label={t("checkIn.turnAway.door")}
    />
  );
  const panel = (
    <TurnAwayScript
      key="turn-away"
      action={action}
      bookingId={row.bookingId}
      reasons={reasons.map((reason) => ({
        value: reason,
        label: t(`checkIn.turnAway.reason.${reason}`),
      }))}
      copy={{
        legend: t("checkIn.turnAway.legend"),
        consequence: t("checkIn.turnAway.consequence"),
        confirm: t("checkIn.turnAway.confirm"),
        confirming: t("checkIn.turnAway.confirming"),
        confirmAriaLabel: t("checkIn.turnAway.confirmAriaLabel", { name: row.personName }),
        sendFailed: t("checkIn.sendFailedButton"),
      }}
    />
  );
  return { door, panel };
}

/**
 * The turn-away door leads the row's controls (beside the Blocked pill, A08)
 * and its confirm sits at the row's foot. Whatever the row already holds in
 * its control slot stays, after the door.
 */
function placeTurnAway(
  turnAway: { door: ReactNode; panel: ReactNode } | null,
  bookingId: string,
  slots: { controls: Map<string, ReactNode>; below: Map<string, ReactNode> },
) {
  if (!turnAway) return;
  const held = slots.controls.get(bookingId);
  slots.controls.set(
    bookingId,
    held ? (
      // One line beside what the row already held ("Checked in", Undo): the
      // action side stays one row at every width (visual triage, layer 3).
      <span className="inline-flex items-center gap-3 whitespace-nowrap">
        {turnAway.door}
        {held}
      </span>
    ) : (
      turnAway.door
    ),
  );
  slots.below.set(bookingId, turnAway.panel);
}
