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
     * Set when the desk turned this diver away (H-124). Required, so the story
     * can never say "no-show" over somebody the desk saw and refused. The
     * category may be null on a turned-away seat (erasure clears it and keeps
     * `turnedAwayAt`).
     */
    turnedAwayReason: string | null;
    turnedAwayAt: Date | null;
    /** A held seat (H-13) sits on this story on a guess. */
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
 * **What was notable about one seat, in the story's own words** (UX review
 * 2026-10-10, item 28). The story used to stamp "waiver signed" on every
 * boat ahead and "sailed" on every boat behind: the norm, said down every row,
 * so nothing on a row told one Saturday from the next.
 *
 * A seat ahead says nothing here: whether the diver is ready is the status
 * ledger's question, asked once at the top of the record. A seat behind says
 * what happened to it when it did not sail (canceled, the trip called off, a
 * no-show), and when it did, what made it this diver's trip: the first dive
 * with the shop, the gear they rented, the stars they gave it. "sailed" is the
 * fallback for a trip that went as trips go ("dived" off a boat).
 *
 * Whether it sailed is the crew's roll call first and the booking second
 * (`seatSailed`): a seat the crew marked `not_boarded` at the dock "stayed
 * ashore" whatever the booking says, and earns no gear, stars or first dive.
 *
 * `firstSailed` is decided by the caller, which sees every row: the earliest
 * seat that sailed, and only when the shop holds no imported history that
 * might come before it.
 */
export function storyNotes(
  entry: StoryNoteBooking,
  { ahead, firstSailed }: { ahead: boolean; firstSailed: boolean },
  t: StaffTranslator,
  locale: string,
): string[] {
  // **Seen at the desk, turned away** (H-124): a past fact even on a boat that
  // has not left yet, so it is said ahead as well as behind. The crew's own
  // word outranks it: a seat they counted aboard has no turn-away left on it.
  // A seat removed afterwards was not the diver cancelling: "then removed"
  // (layer 3 review, dde-2 #2).
  if (entry.booking.turnedAwayAt) {
    // **A held seat says nothing here** (security review 2026-10-16, F1):
    // this story is the matched person's, and the seat sits on it on a guess.
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
      return [t("divers.story.joinedLater")];
    case "notCountedBack":
      return [t("divers.story.notCountedBack")];
    case "sailed":
      break;
  }

  const notes: string[] = [];
  if (firstSailed && seatMayBeFirstDive(entry)) notes.push(t("divers.story.firstDive"));
  const rented = toRentableKinds(entry.booking.paidRentalKinds ?? []);
  if (rented.length > 0) {
    const items = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
      rented.map((kind) => catalogItemLabel(t, kind)),
    );
    notes.push(t("divers.story.rented", { items }));
  }
  if (entry.reviewRating) notes.push(t("divers.story.rated", { rating: entry.reviewRating }));
  if (notes.length > 0) return notes;
  // "sailed" is a boat's word; a shore dive or a pool session is "dived".
  return [t(isBoat(entry) ? "divers.story.sailed" : "divers.story.dived")];
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
