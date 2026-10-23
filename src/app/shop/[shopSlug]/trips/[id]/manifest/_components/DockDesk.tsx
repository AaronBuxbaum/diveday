import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { leftAboardOpen } from "@/lib/trip-phase";
import type { TripStage } from "@/lib/trip-stages";
import { hasSailed } from "@/lib/trips";
import { addDockRiderAction } from "../dock-rider-actions";
import { DockRiderForm } from "./DockRiderForm";
import { dockRiderDoorOpen } from "./dock-rider-door";
import { LostItemsSection } from "./LostItemsSection";

/**
 * **The dock's own two jobs** (batch 4), under the crew list on the Boat tab.
 * Before the boat leaves: add somebody who turned up to ride along (D6), at
 * the departure checkpoint only, only until the crew says the boat has left,
 * and never on a cancelled departure (`dockRiderDoorOpen`). After it sails:
 * what the crew found aboard (J2). The two never show together, because the
 * one is over before the other begins. "Left aboard" waits for "Heading in"
 * (`leftAboardOpen`; fourth review, item 16): while the boat is still diving,
 * a form for what was found after the trip is a question nobody can answer.
 */
export function DockDesk({
  t,
  shopId,
  tripId,
  isDeparture,
  trip,
  timeZone,
  stage,
  seats,
  lostFound,
}: {
  t: StaffTranslator;
  shopId: string;
  tripId: string;
  isDeparture: boolean;
  trip: { startsAt: Date; endsAt: Date; cancelled?: boolean };
  /** The shop's zone, which says which day a crew word was said on. */
  timeZone: string;
  /** The crew's newest word, whatever its age (`latestTripStage`). */
  stage: { stage: TripStage; recordedAt: Date } | null;
  seats: readonly { bookingId: string; fullName: string }[];
  /** Whether the shop keeps a lost-and-found list (`shops.lost_found_enabled`). */
  lostFound: boolean;
}) {
  const now = nowDate();
  const cancelled = trip.cancelled === true;
  const sailed = hasSailed(trip.startsAt, now);
  const atTheDock = dockRiderDoorOpen({ isDeparture, sailed, stage, cancelled });
  return (
    <>
      {atTheDock ? (
        <DockRiderForm
          action={addDockRiderAction.bind(null, tripId)}
          copy={{
            door: t("desk.dockRider.door"),
            name: t("desk.dockRider.name"),
            phone: t("desk.dockRider.phone"),
            optional: t("desk.dockRider.optional"),
            emergencyName: t("desk.dockRider.emergencyName"),
            emergencyPhone: t("desk.dockRider.emergencyPhone"),
            dateOfBirth: t("desk.dockRider.dateOfBirth"),
            aboardAs: t("desk.dockRider.aboardAs"),
            ridesAlong: t("desk.dockRider.ridesAlong"),
            snorkels: t("desk.dockRider.snorkels"),
            submit: t("desk.dockRider.submit"),
            pending: t("desk.dockRider.pending"),
            added: t.raw("desk.dockRider.added"),
            addedOwesRelease: t.raw("desk.dockRider.addedOwesRelease"),
            releaseHandOver: t("desk.dockRider.releaseHandOver"),
            openRelease: t("desk.dockRider.openRelease"),
            owesPayment: t("desk.dockRider.owesPayment"),
            owesOther: t("desk.dockRider.owesOther"),
            refusals: {
              trip_full: t("desk.dockRider.refusals.tripFull"),
              trip_unavailable: t("desk.dockRider.refusals.tripUnavailable"),
              participant_type_unavailable: t("desk.dockRider.refusals.courseSession"),
              departed: t("desk.dockRider.refusals.departed"),
              already_aboard: t("desk.dockRider.refusals.alreadyAboard"),
              invalid: t("desk.dockRider.refusals.invalid"),
              other: t("desk.dockRider.refusals.other"),
            },
          }}
        />
      ) : null}
      {lostFound ? (
        <LostItemsSection
          t={t}
          shopId={shopId}
          tripId={tripId}
          open={leftAboardOpen({ ...trip, now, timeZone, stage, cancelled })}
          seats={seats.map((seat) => ({ bookingId: seat.bookingId, name: seat.fullName }))}
        />
      ) : null}
    </>
  );
}
