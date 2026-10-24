import { after } from "next/server";
import type { AppDb } from "@/db/client";
import { heldSeatOnTrip, tellPartyNotBooked, tellSeatAlreadyHeld } from "@/db/seat-already-held";
import type { DiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";

/**
 * **An address that already holds a seat, or a party rolled back because one
 * member does, is answered by email and nothing else** (issue #2691, Aaron's
 * 2026-10-24 decision; H-22). The public form is anonymous: whoever typed the
 * addresses proved nothing about them, so `bookSpot` lands both cases on one
 * neutral page that says neither whether anything was booked nor which member
 * holds a seat. This schedules the answers for after that response: the holder
 * hears about the seat they already hold, and a party's lead hears that the
 * party did not book, without the member's name. Nobody else is mailed. The
 * data layer has already refused the double seat.
 *
 * Accepted residual: the neutral page is not a fresh booking's landing
 * (`/ready`, Stripe or the embed's confirm page), so the signal narrows rather
 * than closes on this form. The claim page stays fully closed (#2381).
 */
export function answerAlreadyHeld(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    /** The party as submitted, the lead first. */
    party: ReadonlyArray<{ fullName: string; email: string }>;
    /** Which member `createBookingParty` rolled back on. */
    failedIndex: number;
    /** The language the lead's own device asked for. */
    leadLocale: DiverLocale;
  },
): void {
  const { shopId, tripId, party, failedIndex } = input;
  const member = party[failedIndex];
  const lead = party[0];
  after(async () => {
    await trackEvent({ name: "booking_blocked", source: "diver", reason: "already_booked" });
    const held = member?.email
      ? await heldSeatOnTrip(db, { shopId, tripId, email: member.email })
      : null;
    if (held) await tellSeatAlreadyHeld(db, { ...held, attempt: "booking" });
    // A lead who is the holder has just been told their own seat stands.
    if (failedIndex > 0 && lead?.email) {
      await tellPartyNotBooked(db, {
        shopId,
        tripId,
        to: lead.email,
        leadName: lead.fullName,
        locale: input.leadLocale,
      });
    }
  });
}
