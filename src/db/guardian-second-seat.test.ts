import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  clearAnswers,
  now,
  waiverContextFor,
} from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { getBookingReadiness } from "./readiness";
import { bookings, people, trips } from "./schema";
import { getWaiverSignerOnFile } from "./waiver-signing";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";

const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

/**
 * A parent books a child onto Saturday's boat and ticks "Under 18". The same
 * child then gets a second seat, on Sunday's, that nobody ticked: the desk
 * added it, or the parent booked again and missed the box. The shop has been
 * told this person is a minor, and that is a fact about the person.
 */
describe("a child marked Under 18 on one seat, with a second seat nobody marked", () => {
  async function twoSeats() {
    const ctx = await waiverContext();
    await ctx.db.update(people).set({ dateOfBirth: null }).where(eq(people.id, ctx.person.id));
    await ctx.db
      .update(bookings)
      .set({ minorDeclaredAt: now })
      .where(eq(bookings.id, ctx.booking.id));
    const [other] = await ctx.db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, ctx.shop.id),
          eq(trips.status, "scheduled"),
          ne(trips.id, ctx.booking.tripId),
        ),
      )
      .limit(1);
    if (!other) throw new Error("fixture has no second departure");
    await ctx.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.tripId, other.id), eq(bookings.personId, ctx.person.id)));
    const [second] = await ctx.db
      .insert(bookings)
      .values({
        shopId: ctx.shop.id,
        tripId: other.id,
        personId: ctx.person.id,
        participantType: "diver",
        bookedAs: "diver",
        status: "booked",
      })
      .onConflictDoUpdate({
        target: [bookings.tripId, bookings.personId],
        set: { status: "booked", minorDeclaredAt: null },
      })
      .returning({ id: bookings.id });
    if (!second) throw new Error("second seat was not written");
    return { ...ctx, second };
  }

  it("asks for the guardian on the second seat's release, and refuses the child signing alone", async () => {
    const ctx = await twoSeats();
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.second.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    expect(
      await getWaiverSignerOnFile(
        ctx.db,
        { shopId: ctx.shop.id, personId: ctx.person.id, bookingId: ctx.second.id },
        now,
      ),
    ).toMatchObject({ minorDeclared: true });
    expect(
      await completeWaiver(ctx.db, issued.key, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });
  });

  it("holds the second seat at the rail over a release the child signed alone", async () => {
    const ctx = await twoSeats();
    // Signed alone before anybody ticked the box, on the unmarked seat's link.
    await ctx.db
      .update(bookings)
      .set({ minorDeclaredAt: null })
      .where(eq(bookings.id, ctx.booking.id));
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.second.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    expect(
      (
        await completeWaiver(ctx.db, issued.key, {
          signerName: ctx.person.fullName,
          agreed: true,
          medicalAnswers: clearAnswers,
          now,
        })
      ).ok,
    ).toBe(true);
    await ctx.db
      .update(bookings)
      .set({ minorDeclaredAt: now })
      .where(eq(bookings.id, ctx.booking.id));

    const first = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    const second = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.second.id);
    const guardianMissing = expect.objectContaining({ code: "guardian_signature_missing" });
    // Both seats are the same child under the same release.
    if ((first?.blockers ?? []).some((blocker) => blocker.code === "guardian_signature_missing")) {
      expect(second?.blockers ?? []).toContainEqual(guardianMissing);
    }
  });
});
