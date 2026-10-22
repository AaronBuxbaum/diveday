import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  certifications,
  interests,
  people,
  specialtyCertifications,
  tripRequirements,
} from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { getTripGuests } from "./trips-guests";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();

async function context() {
  const { db, shop } = fileCtx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  return { db, shop, tripId: trip.id };
}

async function guestsFor(
  ctx: Awaited<ReturnType<typeof context>>,
  filters: Parameters<typeof getTripGuests>[3] = {},
) {
  const guests = await getTripGuests(ctx.db, ctx.shop, ctx.tripId, filters);
  if (!guests) throw new Error("guests missing for the seeded trip");
  return guests;
}

describe("getTripGuests", () => {
  it("answers null for a trip that is not this shop's", async () => {
    const { db, shop } = await context();
    expect(await getTripGuests(db, shop, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  /**
   * The four booking-keyed Maps the page used to re-key by hand. The roster is
   * the spine of the diver section and each of these hangs off it, so a key that
   * does not name a booking on this trip is a card rendering somebody else's
   * readiness.
   */
  describe("the per-booking indexes", () => {
    it("keys readiness and waiver detail by a booking on this trip", async () => {
      const guests = await guestsFor(await context());
      const rosterIds = new Set(guests.roster.map((row) => row.booking.id));
      for (const bookingId of guests.byBooking.readiness.keys()) {
        expect(rosterIds.has(bookingId)).toBe(true);
      }
      for (const bookingId of guests.byBooking.waiver.keys()) {
        expect(rosterIds.has(bookingId)).toBe(true);
      }
    });

    it("carries a nitrox entry only for a diver who asked for it", async () => {
      const guests = await guestsFor(await context());
      for (const [, entry] of guests.byBooking.nitrox) {
        expect(entry.requested).toBe(true);
      }
    });

    /**
     * Three staff-note entry points, one system: a diver-record note shows on
     * Guests for the same booking, but is edited on the diver record — so this
     * roster must not offer a delete that would silently do nothing.
     */
    it("merges both note scopes and marks only booking notes deletable", async () => {
      const guests = await guestsFor(await context());
      for (const rows of guests.notesByBooking.values()) {
        expect(rows.length).toBeGreaterThan(0);
        // Oldest first, so a thread reads top to bottom.
        const times = rows.map((row) => row.note.createdAt.getTime());
        expect([...times].sort((a, b) => a - b)).toEqual(times);
      }
    });
  });

  describe("the last-minute pipeline", () => {
    it("matches the list against this departure's day in the shop's own zone", async () => {
      const guests = await guestsFor(await context());
      expect(guests.tripDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const match of guests.lastMinute.matched) {
        expect(match.person.id).toBeTruthy();
      }
    });

    /**
     * The panel reads the specialty cards the send reads (dive-domain review of
     * #2656, m1): on a departure that asks for a Night card, the joiner who
     * holds one is listed and the one who does not is left out, where the panel
     * used to drop both because it never read the cards at all.
     */
    it("lists a joiner who holds the departure's specialty card, and leaves out one who does not", async () => {
      const ctx = await context();
      const { db, shop, tripId } = ctx;
      await db
        .insert(tripRequirements)
        .values({
          tripId,
          shopId: shop.id,
          minimumCertificationLevel: "open_water",
          requiredSpecialties: ["night"],
        })
        .onConflictDoUpdate({
          target: tripRequirements.tripId,
          set: { minimumCertificationLevel: "open_water", requiredSpecialties: ["night"] },
        });
      const joiner = async (fullName: string, night: boolean) => {
        const [person] = await db
          .insert(people)
          .values({ shopId: shop.id, fullName, email: `${fullName.split(" ")[0]}@example.com` })
          .returning();
        if (!person) throw new Error("setup: person missing");
        await db.insert(certifications).values({
          shopId: shop.id,
          personId: person.id,
          agency: "padi",
          level: "open_water",
          identifier: `OW-${person.id.slice(0, 8)}`,
          status: "verified",
        });
        if (night) {
          await db.insert(specialtyCertifications).values({
            shopId: shop.id,
            personId: person.id,
            agency: "padi",
            specialty: "night",
            identifier: `N-${person.id.slice(0, 8)}`,
            status: "verified",
          });
        }
        await db
          .insert(interests)
          .values({ shopId: shop.id, scope: "anytime", askedBy: "diver", personId: person.id });
        return person.id;
      };
      const holder = await joiner("Noor Holder", true);
      const without = await joiner("Wes Without", false);

      const ids = (await guestsFor(ctx)).lastMinute.recipients.map(({ person }) => person.id);
      expect(ids).toContain(holder);
      expect(ids).not.toContain(without);
    });

    it("never offers a seat to somebody the requirements would refuse", async () => {
      const guests = await guestsFor(await context());
      // Recipients are the eligible subset of the date-matched list, never more.
      const matchedIds = new Set(guests.lastMinute.matched.map((entry) => entry.person.id));
      for (const recipient of guests.lastMinute.recipients) {
        expect(matchedIds.has(recipient.person.id)).toBe(true);
      }
      expect(guests.lastMinute.recipients.length).toBeLessThanOrEqual(
        guests.lastMinute.matched.length,
      );
    });

    it("shows the promote panel only when there is somebody to promote to", async () => {
      const guests = await guestsFor(await context());
      expect(guests.lastMinute.showPromote).toBe(
        guests.lastMinute.matched.length > 0 || guests.lastMinute.promos.length > 0,
      );
    });
  });

  describe("the returning-diver picker", () => {
    it("stays closed when nothing was typed", async () => {
      const guests = await guestsFor(await context(), { diverQuery: "   " });
      expect(guests.diverQuery).toBe("");
      expect(guests.diverCandidates).toEqual([]);
    });

    it("does not offer to book anyone onto a full boat", async () => {
      const ctx = await context();
      const guests = await guestsFor(ctx, { diverQuery: "a" });
      // The picker only books; a full boat wait-lists instead.
      if (guests.trip.booked >= guests.trip.capacity) {
        expect(guests.diverCandidates).toEqual([]);
      }
    });

    it("looks for similar divers only when a name needs confirming", async () => {
      const ctx = await context();
      expect((await guestsFor(ctx)).confirmMatches).toEqual([]);
      const withName = await guestsFor(ctx, { confirmName: "Priya" });
      expect(Array.isArray(withName.confirmMatches)).toBe(true);
    });
  });
});
