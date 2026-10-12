import { catalogItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import { toRentableKinds } from "@/lib/rentals";

/** The slice of one booking row the story's notes are read from. */
export type StoryNoteBooking = {
  booking: { id: string; status: string; paidRentalKinds?: readonly string[] | null };
  trip: { status: string };
  reviewRating?: number | null;
};

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
 * fallback for a trip that went as trips go.
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
  if (ahead) return [];
  if (entry.booking.status === "cancelled") return [t("divers.story.canceled")];
  if (entry.trip.status === "cancelled") return [t("divers.story.tripCalledOff")];
  if (entry.booking.status === "no_show") return [t("divers.story.noShow")];

  const notes: string[] = [];
  if (firstSailed) notes.push(t("divers.story.firstDive"));
  const rented = toRentableKinds(entry.booking.paidRentalKinds ?? []);
  if (rented.length > 0) {
    const items = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
      rented.map((kind) => catalogItemLabel(t, kind)),
    );
    notes.push(t("divers.story.rented", { items }));
  }
  if (entry.reviewRating) notes.push(t("divers.story.rated", { rating: entry.reviewRating }));
  return notes.length > 0 ? notes : [t("divers.story.sailed")];
}

/** Whether a seat behind the diver actually went to sea: the one `firstSailed` is chosen from. */
export function seatWentToSea(entry: StoryNoteBooking): boolean {
  return (
    entry.booking.status !== "cancelled" &&
    entry.booking.status !== "no_show" &&
    entry.trip.status !== "cancelled"
  );
}
