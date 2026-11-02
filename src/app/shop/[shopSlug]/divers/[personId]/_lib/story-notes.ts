import { catalogItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { seatSailed } from "@/lib/closeout";
import { cachedListFormat } from "@/lib/intl-cache";
import { toRentableKinds } from "@/lib/rentals";

/**
 * **The crew's standing word on one seat**: the result at the `departure`
 * checkpoint, and the strongest one standing at any after-dive checkpoint
 * (`boarded` outranks `missing_after_dive`, as `listAfterDiveRollCallByTrip`
 * reads it). Null where the crew said nothing.
 */
export type StorySeatRollCall = {
  dock: "boarded" | "not_boarded" | null;
  afterDive: "boarded" | "missing_after_dive" | null;
};

/** The slice of one booking row the story's notes are read from. */
export type StoryNoteBooking = {
  booking: {
    id: string;
    status: string;
    paidRentalKinds?: readonly string[] | null;
    /**
     * Set when the desk turned this diver away (H-20261015-who-may-turn-someone). Required, so the story
     * can never say "no-show" over somebody the desk saw and refused. The
     * category may be null on a turned-away seat (erasure clears it and keeps
     * `turnedAwayAt`).
     */
    turnedAwayReason: string | null;
    turnedAwayAt: Date | null;
    /** A held seat (H-20260724-one-person-per-email) sits on this story on a guess. */
    identityUnconfirmedAt?: Date | null;
  };
  trip: { status: string; diveMode?: "boat" | "shore" | "pool" | null };
  reviewRating?: number | null;
  /**
   * Required, never defaulted: a caller that forgot it would put back the
   * story that read "sailed" over a diver the crew left on the dock.
   */
  rollCall: StorySeatRollCall;
};

/**
 * What became of one seat behind the diver, strongest statement first. The
 * sailed-or-not half is `seatSailed` (src/lib/closeout.ts), the one rule every
 * count of who the boat carried reads, so the story and the evening's souls on
 * board can never disagree about a seat.
 */
type SeatOutcome =
  | "cancelled"
  | "tripCalledOff"
  | "stayedAshore"
  | "joinedLater"
  | "noShow"
  | "notCountedBack"
  | "sailed";

function seatOutcome(entry: StoryNoteBooking): SeatOutcome {
  if (entry.booking.status === "cancelled") return "cancelled";
  if (entry.trip.status === "cancelled") return "tripCalledOff";
  const { dock, afterDive } = entry.rollCall;
  const sailed = seatSailed({
    noShow: entry.booking.status === "no_show",
    dockResult: dock,
    afterDiveResultStands: afterDive !== null,
  });
  // The crew's last word is that this diver was not back aboard after a dive.
  // The seat still counts as sailed (the boat carried them out), but the story
  // never says the ordinary "sailed" over it, nor credits gear, stars or a
  // first dive to it.
  if (sailed) return afterDive === "missing_after_dive" ? "notCountedBack" : "sailed";
  // Ashore at the dock is the crew's own statement, and it outranks the desk.
  // A later checkpoint that counted them aboard means they were picked up
  // after the boat left: not "sailed" (the vessel did not leave with them),
  // and not "stayed ashore" either.
  if (dock === "not_boarded") return afterDive === "boarded" ? "joinedLater" : "stayedAshore";
  return "noShow";
}

const isBoat = (entry: StoryNoteBooking) => (entry.trip.diveMode ?? "boat") === "boat";

/**
 * Notes describe only the notable history behind a seat. Crew dock and
 * after-dive roll call outrank booking status through `seatSailed`; turn-away
 * remains distinct from no-show and removal. A turn-away story is suppressed
 * when its held seat's identity is unconfirmed. A seat joined after departure
 * keeps rental and rating notes, never first-dive credit. The caller selects
 * `firstSailed` only when imported history cannot predate the known bookings.
 */
export function storyNotes(
  entry: StoryNoteBooking,
  { ahead, firstSailed }: { ahead: boolean; firstSailed: boolean },
  t: StaffTranslator,
  locale: string,
): string[] {
  // A turn-away is distinct from a later no-show or removal; crew roll call
  // overrides it when the diver was counted aboard.
  if (entry.booking.turnedAwayAt) {
    // Suppress this turn-away story when the held seat's identity is
    // unconfirmed.
    if (entry.booking.identityUnconfirmedAt) return [];
    const reason = entry.booking.turnedAwayReason ?? "unstated";
    if (entry.booking.status === "no_show") return [t("divers.story.turnedAway", { reason })];
    if (entry.booking.status === "cancelled") {
      return [t("divers.story.turnedAwayRemoved", { reason })];
    }
  }
  if (ahead) return [];
  switch (seatOutcome(entry)) {
    case "cancelled":
      return [t("divers.story.canceled")];
    case "tripCalledOff":
      return [t("divers.story.tripCalledOff")];
    case "noShow":
      return [t("divers.story.noShow")];
    case "stayedAshore":
      return [t(isBoat(entry) ? "divers.story.stayedAshore" : "divers.story.didNotDive")];
    case "joinedLater":
      // Keep rental and rating notes, but never first-dive credit.
      return [t("divers.story.joinedLater"), ...gearAndRatingNotes(entry, t, locale)];
    case "notCountedBack":
      return [t("divers.story.notCountedBack")];
    case "sailed":
      break;
  }

  const notes: string[] = [];
  if (firstSailed && seatMayBeFirstDive(entry)) notes.push(t("divers.story.firstDive"));
  notes.push(...gearAndRatingNotes(entry, t, locale));
  if (notes.length > 0) return notes;
  // "sailed" is a boat's word; a shore dive or a pool session is "dived".
  return [t(isBoat(entry) ? "divers.story.sailed" : "divers.story.dived")];
}

/** The gear rented and the stars given on one seat, in that order. */
function gearAndRatingNotes(entry: StoryNoteBooking, t: StaffTranslator, locale: string): string[] {
  const notes: string[] = [];
  const rented = toRentableKinds(entry.booking.paidRentalKinds ?? []);
  if (rented.length > 0) {
    const items = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
      rented.map((kind) => catalogItemLabel(t, kind)),
    );
    notes.push(t("divers.story.rented", { items }));
  }
  if (entry.reviewRating) notes.push(t("divers.story.rated", { rating: entry.reviewRating }));
  return notes;
}

/** Whether a seat behind the diver actually went out, by `seatSailed`. */
export function seatWentToSea(entry: StoryNoteBooking): boolean {
  const outcome = seatOutcome(entry);
  return outcome === "sailed" || outcome === "notCountedBack";
}

/**
 * Whether a seat may be the one `firstSailed` is chosen from: it sailed, and
 * no `not_boarded` stands anywhere on it. A seat the crew spoke against at any
 * checkpoint is never the diver's "first dive with us", even where the crew's
 * silence elsewhere still counts it as sailed.
 */
export function seatMayBeFirstDive(entry: StoryNoteBooking): boolean {
  if (seatOutcome(entry) !== "sailed") return false;
  return entry.rollCall.dock !== "not_boarded";
}
