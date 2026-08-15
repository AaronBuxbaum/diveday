import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, lastMinuteListEntries, people } from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";

/**
 * The seeded declarations exist so a mark that is only ever rendered in jsdom
 * gets rendered somewhere real. These tests guard the two properties the
 * screenshots and the e2e spec rest on: that the marks are actually *there*, and
 * that putting them there moved nothing else.
 */
describe("seeded self-declared joiners", () => {
  async function joiner(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    fullName: string,
  ) {
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)))
      .limit(1);
    if (!person) throw new Error(`expected the seeded joiner ${fullName}`);
    return person.id;
  }

  it("puts one unchecked claim and one 'not certified yet' on the shop's last-minute list", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const claimed = await joiner(db, shop.id, "Rowan Feld");
    const uncertified = await joiner(db, shop.id, "Selah Mbeki");

    const summaries = await listCertificationSummaries(db, shop.id, [claimed, uncertified]);
    // A claim, marked as one on both halves — the level and the enriched-air
    // tick carry the mark independently, which is the shape the panel draws.
    expect(summaries.get(claimed)).toMatchObject({
      level: "open_water",
      levelSelfDeclared: true,
      noCertificationDeclared: false,
      nitrox: true,
      nitroxSelfDeclared: true,
    });
    // The stamp, and no card at all: "I hold none" is never a certification row.
    expect(summaries.get(uncertified)).toMatchObject({
      level: null,
      levelSelfDeclared: false,
      noCertificationDeclared: true,
      nitrox: false,
    });

    // Both are on the list, or the panel they exist for never draws them.
    for (const personId of [claimed, uncertified]) {
      const entries = await db
        .select()
        .from(lastMinuteListEntries)
        .where(
          and(
            eq(lastMinuteListEntries.shopId, shop.id),
            eq(lastMinuteListEntries.personId, personId),
          ),
        );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.unsubscribedAt).toBeNull();
    }
  });

  it("seats neither of them, so no readiness count or roster moves", async () => {
    // The assumption the whole seed rests on. A self-declared card on a diver
    // who holds a seat flips that seat's blocker from `certification_missing` to
    // `certification_self_declared`, and the demo's readiness counts are
    // asserted exactly by e2e/check-in.spec.ts and e2e/today.spec.ts. A future
    // seed that books either of these joiners would break those specs from a
    // long way away, so it is asserted here rather than assumed.
    const { db, shop } = await seededShopContext({ history: true });
    for (const fullName of ["Rowan Feld", "Selah Mbeki"]) {
      const personId = await joiner(db, shop.id, fullName);
      const booked = await db.select().from(bookings).where(eq(bookings.personId, personId));
      expect(booked).toEqual([]);
    }
  });

  it("stays out of a shop with no last-minute list at all", async () => {
    // The lean template and every freshly minted demo shop run with history off
    // and have no list. An entry there would raise a `last_minute_fill` row on a
    // Today board that has never had one.
    const { db, shop } = await seededShopContext();
    const found = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Rowan Feld")));
    expect(found).toEqual([]);
  });
});
