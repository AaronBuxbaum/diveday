import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { issuedCardsForTrip, listCardsToProcess, setCardProcessed } from "./agency-processing";
import { certifications, courses, people, trips } from "./schema";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const now = nowDate();
  const [course] = await db
    .insert(courses)
    .values({
      shopId: shop.id,
      title: "Open Water",
      slug: `processing-ow-${now.getTime()}`,
      agency: "PADI",
      certifiesLevel: "open_water",
    })
    .returning();
  const startsAt = new Date(now.getTime() - 3 * DAY_MS);
  const [session] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "OW weekend",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000),
      capacity: 6,
      courseId: course.id,
    })
    .returning();
  const [priya, tom, old] = await db
    .insert(people)
    .values(
      ["Priya Sharma", "Tom Okafor", "Old Card"].map((fullName) => ({
        shopId: shop.id,
        fullName,
        email: `${fullName.split(" ")[0].toLowerCase()}-${now.getTime()}@processing.example`,
      })),
    )
    .returning();
  const card = (personId: string, issuedAt: Date | null) => ({
    shopId: shop.id,
    personId,
    agency: "padi" as const,
    level: "open_water" as const,
    status: "verified" as const,
    issuedByShopAt: issuedAt,
    issuedFromTripId: issuedAt ? session.id : null,
    identifier: issuedAt ? null : "OW-12345",
  });
  const [priyaCard, tomCard, oldCard] = await db
    .insert(certifications)
    .values([
      card(priya.id, new Date(now.getTime() - 2 * DAY_MS)),
      card(tom.id, null),
      card(old.id, new Date(now.getTime() - 120 * DAY_MS)),
    ])
    .returning();
  const mine = new Set([priya.id, tom.id, old.id]);
  const listed = async () =>
    (await listCardsToProcess(db, shop.id, now))
      .filter((row) => mine.has(row.personId))
      .map((row) => row.fullName);
  return { db, shop, owner: tom, now, session, priya, priyaCard, tomCard, oldCard, listed };
}

describe("agency processing", () => {
  it("lists a card the shop issued until someone ticks it processed, and the tick comes back off", async () => {
    const { db, shop, owner, now, session, priya, priyaCard, listed } = await fixture();

    expect(await listed()).toEqual(["Priya Sharma"]);
    expect(
      (await issuedCardsForTrip(db, shop.id, session.id)).get(priya.id)?.processedAt,
    ).toBeNull();

    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        certificationId: priyaCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
        tripId: session.id,
      }),
    ).toBe(true);
    expect(await listed()).toEqual([]);
    const [stamped] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.id, priyaCard.id));
    expect(stamped.processedByPersonId).toBe(owner.id);

    await setCardProcessed(db, {
      shopId: shop.id,
      certificationId: priyaCard.id,
      actorPersonId: owner.id,
      processed: false,
      now,
    });
    expect(await listed()).toEqual(["Priya Sharma"]);
  });

  it("refuses a card the shop did not issue, or one from another session", async () => {
    const { db, shop, owner, now, tomCard, oldCard } = await fixture();
    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        certificationId: tomCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
      }),
    ).toBe(false);
    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        certificationId: oldCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
        tripId: crypto.randomUUID(),
      }),
    ).toBe(false);
  });
});
