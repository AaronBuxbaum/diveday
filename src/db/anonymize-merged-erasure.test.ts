import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { getDiverMergePreview, mergeDiverRecords } from "./diver-merge";
import { recordCrewRollCall } from "./manifests";
import { people, personRoles, rollCallCrewEvents, shops, tripAssignments, trips } from "./schema";

const fileCtx = fileScopedShopContext({ history: true });

async function erasureFixtures() {
  const { db, shop } = fileCtx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return { db, shop, owner };
}

describe("anonymizeDiver — a real merged diver chain", () => {
  it("erases personal fields across more than 64 ordinary merges", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [first] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Deep Chain Diver",
        email: "deep-chain-old@example.test",
        dateOfBirth: "1990-04-02",
      })
      .returning({ id: people.id });
    if (!first) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: first.id, role: "diver" });

    // Build the chain only through the ordinary merge writer. Each source has
    // diver data and no staff history, satisfying the live merge guards.
    let sourceId = first.id;
    const chainIds = [first.id];
    for (let index = 2; index <= 66; index += 1) {
      const [survivor] = await db
        .insert(people)
        .values({
          shopId: shop.id,
          fullName: "Deep Chain Diver",
          dateOfBirth: "1990-04-02",
        })
        .returning({ id: people.id });
      if (!survivor) throw new Error("fixture insert failed");
      await db.insert(personRoles).values({ personId: survivor.id, role: "diver" });
      const merged = await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: sourceId,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      });
      expect(merged).toMatchObject({ ok: true });
      sourceId = survivor.id;
      chainIds.push(survivor.id);
    }

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: sourceId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    const rows = await db
      .select({ id: people.id, fullName: people.fullName, email: people.email })
      .from(people)
      .where(inArray(people.id, chainIds));
    expect(rows).toHaveLength(66);
    expect(rows.every((row) => row.fullName === "[anonymized]" && row.email === null)).toBe(true);
  });
});

describe("anonymizeDiver — a third-party roll-call note that names the diver", () => {
  it("redacts the target and merged-shell names but keeps unrelated crew prose", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, erased] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Rose Chen", dateOfBirth: "1990-04-02" },
        { shopId: shop.id, fullName: "Adaeze Nwosu", dateOfBirth: "1990-04-02" },
      ])
      .returning({ id: people.id });
    if (!source || !erased) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: erased.id, role: "diver" },
    ]);
    const preview = await getDiverMergePreview(db, shop.id, source.id, erased.id);
    if (!preview) throw new Error("expected a same-shop diver merge preview");
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: erased.id,
      actorPersonId: owner.id,
      acknowledged: preview.acknowledgement,
    });
    expect(merged.ok).toBe(true);
    const [namesake] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Rose Chen", dateOfBirth: "1988-07-12" })
      .returning({ id: people.id });
    if (!namesake) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: namesake.id, role: "diver" });
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Other Crew Note Shop",
        slug: `other-crew-note-${shop.id.slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning({ id: shops.id });
    if (!erased || !otherShop) throw new Error("fixture insert failed");
    const [otherPerson] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other Crew Member" })
      .returning({ id: people.id });
    if (!otherPerson) throw new Error("fixture insert failed");
    const [shopTrip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Crew Note Dive",
        startsAt: new Date("2026-11-01T12:00:00.000Z"),
        endsAt: new Date("2026-11-01T15:00:00.000Z"),
        capacity: 8,
      })
      .returning({ id: trips.id });
    const [otherTrip] = await db
      .insert(trips)
      .values({
        shopId: otherShop.id,
        title: "Other Shop Dive",
        startsAt: new Date("2026-11-01T12:00:00.000Z"),
        endsAt: new Date("2026-11-01T15:00:00.000Z"),
        capacity: 8,
      })
      .returning({ id: trips.id });
    if (!shopTrip || !otherTrip) throw new Error("fixture insert failed");
    const occurredAt = new Date("2026-10-20T12:00:00.000Z");
    await db.insert(tripAssignments).values({ tripId: shopTrip.id, personId: owner.id });
    for (const note of [
      "Last saw Bob with Rose Chen at the stern.",
      "Adaeze checked the oxygen bank before departure.",
      "The rose was left by the tank.",
      "Rose Chen was in the office all morning.",
      "Bob checked the oxygen bank before departure.",
    ]) {
      const written = await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: shopTrip.id,
        personId: owner.id,
        recordedByPersonId: owner.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt,
        note,
      });
      expect(written).toMatchObject({ ok: true });
    }
    await db.insert(rollCallCrewEvents).values({
      shopId: otherShop.id,
      tripId: otherTrip.id,
      personId: otherPerson.id,
      recordedByPersonId: otherPerson.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt,
      note: "Last saw Bob with Rose Chen at the stern.",
    });
    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: erased.id,
      actorPersonId: owner.id,
    });
    expect(result.ok).toBe(true);
    const sameShopEvents = await db
      .select({ note: rollCallCrewEvents.note })
      .from(rollCallCrewEvents)
      .where(
        and(eq(rollCallCrewEvents.shopId, shop.id), eq(rollCallCrewEvents.tripId, shopTrip.id)),
      )
      .orderBy(rollCallCrewEvents.id);
    expect(sameShopEvents.map((event) => event.note).sort()).toEqual(
      [
        "Last saw Bob with [redacted] at the stern.",
        "[redacted] checked the oxygen bank before departure.",
        "The [redacted] was left by the tank.",
        "[redacted] was in the office all morning.",
        "Bob checked the oxygen bank before departure.",
      ].sort(),
    );
    const [foreignEvent] = await db
      .select({ note: rollCallCrewEvents.note })
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.shopId, otherShop.id),
          eq(rollCallCrewEvents.tripId, otherTrip.id),
        ),
      );
    expect(foreignEvent?.note).toBe("Last saw Bob with Rose Chen at the stern.");
    const [unrelatedNamesake] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(eq(people.id, namesake.id));
    expect(unrelatedNamesake?.fullName).toBe("Rose Chen");
  });
});
