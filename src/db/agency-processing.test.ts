import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  CARD_PROCESSING_SINCE,
  cardIsLate,
  issuedCardsForTrip,
  listCardsToProcess,
  setCardProcessed,
  splitCardsToProcess,
} from "./agency-processing";
import {
  certifications,
  courses,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  trips,
} from "./schema";

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
    (await listCardsToProcess(db, shop.id))
      .filter((row) => mine.has(row.personId))
      .map((row) => row.fullName);
  return { db, shop, owner: tom, now, session, priya, priyaCard, tomCard, oldCard, listed };
}

describe("agency processing", () => {
  it("lists a card the shop issued until someone ticks it processed, and the tick comes back off", async () => {
    const { db, shop, owner, now, session, priya, priyaCard, listed } = await fixture();

    // Oldest first, and a 120-day-old card is still on the list (review F5).
    expect(await listed()).toEqual(["Old Card", "Priya Sharma"]);
    expect(
      (await issuedCardsForTrip(db, shop.id, session.id)).get(priya.id)?.processedAt,
    ).toBeNull();

    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: priyaCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
        tripId: session.id,
      }),
    ).toBe(true);
    expect(await listed()).toEqual(["Old Card"]);
    const [stamped] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.id, priyaCard.id));
    expect(stamped.processedByPersonId).toBe(owner.id);

    await setCardProcessed(db, {
      shopId: shop.id,
      kind: "level",
      certificationId: priyaCard.id,
      actorPersonId: owner.id,
      processed: false,
      now,
    });
    expect(await listed()).toEqual(["Old Card", "Priya Sharma"]);
  });

  it("refuses a card the shop did not issue, or one from another session", async () => {
    const { db, shop, owner, now, tomCard, oldCard } = await fixture();
    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: tomCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
      }),
    ).toBe(false);
    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: oldCard.id,
        actorPersonId: owner.id,
        processed: true,
        now,
        tripId: crypto.randomUUID(),
      }),
    ).toBe(false);
  });

  it("lists and ticks the Enriched Air and specialty cards a session issued, not only level cards", async () => {
    const { db, shop, owner, now, session, priya } = await fixture();
    const issued = {
      issuedByShopAt: new Date(now.getTime() - DAY_MS),
      issuedFromTripId: session.id,
    };
    const [nitrox] = await db
      .insert(nitroxCertifications)
      .values({
        shopId: shop.id,
        personId: priya.id,
        agency: "padi",
        status: "pending",
        identifier: null,
        ...issued,
      })
      .returning();
    const [deep] = await db
      .insert(specialtyCertifications)
      .values({
        shopId: shop.id,
        personId: priya.id,
        agency: "padi",
        specialty: "deep",
        status: "pending",
        identifier: null,
        ...issued,
      })
      .returning();
    const kinds = async () =>
      (await listCardsToProcess(db, shop.id))
        .filter((row) => row.personId === priya.id)
        .map((row) => row.what);
    expect(await kinds()).toEqual(
      expect.arrayContaining([
        { kind: "level", level: "open_water" },
        { kind: "nitrox" },
        { kind: "specialty", specialty: "deep" },
      ]),
    );

    for (const [kind, id] of [
      ["nitrox", nitrox.id],
      ["specialty", deep.id],
    ] as const) {
      expect(
        await setCardProcessed(db, {
          shopId: shop.id,
          kind,
          certificationId: id,
          actorPersonId: owner.id,
          processed: true,
          now,
          tripId: session.id,
        }),
      ).toBe(true);
    }
    expect(await kinds()).toEqual([{ kind: "level", level: "open_water" }]);

    // The id names the table: a nitrox id ticked as a level card changes nothing.
    expect(
      await setCardProcessed(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: nitrox.id,
        actorPersonId: owner.id,
        processed: false,
        now,
      }),
    ).toBe(false);
  });

  it("refuses the processed stamp on a specialty card the shop did not issue", async () => {
    const { db, shop, priya, now, owner } = await fixture();
    await expect(
      db.insert(specialtyCertifications).values({
        shopId: shop.id,
        personId: priya.id,
        agency: "padi",
        specialty: "wreck",
        status: "verified",
        identifier: "W-1",
        processedWithAgencyAt: now,
        processedByPersonId: owner.id,
      }),
    ).rejects.toThrow();
  });

  it("never lists another shop's cards", async () => {
    const { db, shop } = await fixture();
    const [other] = await db
      .insert(shops)
      .values({
        name: "Elsewhere",
        slug: `elsewhere-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning();
    const theirs = await listCardsToProcess(db, other.id);
    expect(theirs).toEqual([]);
    expect((await listCardsToProcess(db, shop.id)).length).toBeGreaterThan(0);
  });

  it("calls a card late after 30 days, and never before", () => {
    const now = new Date(CARD_PROCESSING_SINCE.getTime() + 60 * DAY_MS);
    expect(cardIsLate(new Date(now.getTime() - 30 * DAY_MS), now)).toBe(false);
    expect(cardIsLate(new Date(now.getTime() - 31 * DAY_MS), now)).toBe(true);
  });

  it("never calls a card from before the processed stamp late, and sets it apart (X2)", () => {
    const since = CARD_PROCESSING_SINCE.getTime();
    const now = new Date(since + 400 * DAY_MS);
    const old = { id: "old", issuedAt: new Date(since - 1) };
    const atCut = { id: "at-cut", issuedAt: new Date(since) };
    const recent = { id: "recent", issuedAt: new Date(since + 10 * DAY_MS) };
    expect(cardIsLate(old.issuedAt, now)).toBe(false);
    expect(cardIsLate(atCut.issuedAt, now)).toBe(true);
    expect(splitCardsToProcess([old, atCut, recent])).toEqual({
      current: [atCut, recent],
      earlier: [old],
    });
  });
});
