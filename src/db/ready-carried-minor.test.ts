// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { carriedPreparationForDiver } from "./ready";
import { bookings, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * **A called-off day never tells a declared minor's family their solo
 * signature was kept** (issue #2553, domain review). The seat booked "Under
 * 18" was on the departure that was called off; that is the seat this card
 * is about, so its stamp still speaks.
 */

const ctx = fileScopedShopContext();

async function soloSignerOnCalledOffDay(email: string, declared: boolean) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Lu Young", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
  if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: "Lu Young",
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  if (!done.ok) throw new Error("waiver completion failed");
  const [seat] = await db
    .update(bookings)
    .set({ minorDeclaredAt: declared ? nowDate() : null, status: "cancelled" })
    .where(eq(bookings.id, bookingId))
    .returning();
  if (!seat) throw new Error("seat missing");
  await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, reef.id));
  return { db, shop, personId: seat.personId };
}

describe("carriedPreparationForDiver and a booked Under 18 (#2553)", () => {
  it("does not carry a solo release for a diver the called-off seat named under 18", async () => {
    const s = await soloSignerOnCalledOffDay("carried-minor@example.com", true);
    expect(
      await carriedPreparationForDiver(s.db, {
        shopId: s.shop.id,
        personId: s.personId,
        hasRentalFit: false,
      }),
    ).not.toContain("waiver");
  });

  it("still carries it when nobody said under 18", async () => {
    const s = await soloSignerOnCalledOffDay("carried-adult@example.com", false);
    expect(
      await carriedPreparationForDiver(s.db, {
        shopId: s.shop.id,
        personId: s.personId,
        hasRentalFit: false,
      }),
    ).toContain("waiver");
  });
});
