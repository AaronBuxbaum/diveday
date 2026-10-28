import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { mergeDiverRecords } from "./diver-merge";
import {
  people,
  personRoles,
  rollCallCrewEvents,
  shops,
  staffCredentialHistory,
  staffCredentials,
  trips,
} from "./schema";

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

describe("anonymizeDiver — data on merged diver shells", () => {
  it("erases shell credentials, history and snapshots within its shop", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, survivor] = await db
      .insert(people)
      .values([
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@old.example",
          dateOfBirth: "1990-04-02",
        },
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@new.example",
          dateOfBirth: "1990-04-02",
        },
      ])
      .returning({ id: people.id });
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    // Historical/orphaned shell state: the current merge guard rejects these rows.
    const [shellTrip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Shell Dive",
        startsAt: new Date("2026-11-01T12:00:00.000Z"),
        endsAt: new Date("2026-11-01T15:00:00.000Z"),
        capacity: 8,
      })
      .returning({ id: trips.id });
    if (!shellTrip) throw new Error("fixture insert failed");
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Other Shell Erasure Shop",
        slug: `other-shell-erasure-${shop.id.slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("fixture insert failed");
    const [otherPerson] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other Instructor" })
      .returning({ id: people.id });
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
    if (!otherPerson || !otherTrip) throw new Error("fixture insert failed");
    const [credential] = await db
      .insert(staffCredentials)
      .values({
        shopId: shop.id,
        personId: source.id,
        kind: "instructor_rating",
        name: "Instructor rating",
        issuingBody: "Agency",
        identifier: "ADA-1234",
        issuedAt: "2024-01-01",
        renewsAt: "2027-01-01",
        status: "verified",
      })
      .returning({ id: staffCredentials.id });
    const [otherCredential] = await db
      .insert(staffCredentials)
      .values({
        shopId: otherShop.id,
        personId: source.id,
        kind: "instructor_rating",
        name: "Other instructor rating",
        issuingBody: "Other Agency",
        identifier: "OTHER-9876",
        issuedAt: "2024-01-01",
        renewsAt: "2027-01-01",
        status: "verified",
      })
      .returning({ id: staffCredentials.id });
    if (!credential || !otherCredential) throw new Error("fixture insert failed");
    await db.insert(staffCredentialHistory).values([
      {
        shopId: shop.id,
        credentialId: credential.id,
        event: "created",
        kind: "instructor_rating",
        issuedAt: "2024-01-01",
        renewsAt: "2027-01-01",
        active: true,
      },
      {
        shopId: otherShop.id,
        credentialId: otherCredential.id,
        event: "created",
        kind: "instructor_rating",
        issuedAt: "2024-01-01",
        renewsAt: "2027-01-01",
        active: true,
      },
    ]);
    const occurredAt = new Date("2026-10-20T12:00:00.000Z");
    await db.insert(rollCallCrewEvents).values([
      {
        shopId: shop.id,
        tripId: shellTrip.id,
        personId: source.id,
        recordedByPersonId: owner.id,
        status: "boarded",
        checkpoint: "departure",
        occurredAt,
        note: "Instructor saw Adaeze assist at the stern.",
        credentialSnapshot: [
          { kind: "instructor_rating", issuedAt: "2024-01-01", renewsAt: "2027-01-01" },
        ],
        credentialSnapshotStartedAt: occurredAt,
        credentialSnapshotCapturedAt: occurredAt,
      },
      {
        shopId: otherShop.id,
        tripId: otherTrip.id,
        personId: source.id,
        recordedByPersonId: otherPerson.id,
        status: "boarded",
        checkpoint: "departure",
        occurredAt,
        note: "Other shop note stays with its record.",
        credentialSnapshot: [
          { kind: "instructor_rating", issuedAt: "2024-01-01", renewsAt: "2027-01-01" },
        ],
        credentialSnapshotStartedAt: occurredAt,
        credentialSnapshotCapturedAt: occurredAt,
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    const [shell] = await db.select().from(people).where(eq(people.id, source.id));
    expect(shell).toMatchObject({ fullName: "[anonymized]", email: null });
    expect(shell?.mergedIntoPersonId).toBe(survivor.id);
    const [redactedCredential] = await db
      .select()
      .from(staffCredentials)
      .where(eq(staffCredentials.id, credential.id));
    expect(redactedCredential).toMatchObject({
      name: "[redacted]",
      issuingBody: null,
      identifier: null,
      issuedAt: null,
      renewsAt: null,
      deletedByPersonId: owner.id,
    });
    expect(redactedCredential?.deletedAt).not.toBeNull();
    await expect(
      db
        .select()
        .from(staffCredentialHistory)
        .where(eq(staffCredentialHistory.credentialId, credential.id)),
    ).resolves.toEqual([]);
    const [crewEvent] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.personId, source.id));
    expect(crewEvent).toMatchObject({
      note: null,
      credentialSnapshot: null,
      credentialSnapshotStartedAt: null,
      credentialSnapshotCapturedAt: null,
    });
    const [foreignCredential] = await db
      .select()
      .from(staffCredentials)
      .where(eq(staffCredentials.id, otherCredential.id));
    expect(foreignCredential).toMatchObject({
      name: "Other instructor rating",
      identifier: "OTHER-9876",
      deletedAt: null,
    });
    await expect(
      db
        .select()
        .from(staffCredentialHistory)
        .where(eq(staffCredentialHistory.credentialId, otherCredential.id)),
    ).resolves.toHaveLength(1);
    const [foreignCrewEvent] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.shopId, otherShop.id),
          eq(rollCallCrewEvents.personId, source.id),
        ),
      );
    expect(foreignCrewEvent).toMatchObject({
      note: "Other shop note stays with its record.",
      credentialSnapshot: [
        { kind: "instructor_rating", issuedAt: "2024-01-01", renewsAt: "2027-01-01" },
      ],
      credentialSnapshotStartedAt: occurredAt,
      credentialSnapshotCapturedAt: occurredAt,
    });
  });

  it("reaches credentials beyond 64 merged shells", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Deep Chain Diver", dateOfBirth: "1990-04-02" },
        { shopId: shop.id, fullName: "Deep Chain Diver", dateOfBirth: "1990-04-02" },
      ])
      .returning({ id: people.id });
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    // Persist a valid historical chain beyond the old traversal cap.
    let parentId = source.id;
    let deepestId = source.id;
    for (let depth = 2; depth <= 65; depth += 1) {
      const [shell] = await db
        .insert(people)
        .values({
          shopId: shop.id,
          fullName: `Deep Chain Shell ${depth}`,
          email: `deep-chain-${depth}@example.test`,
          deletedAt: new Date("2026-10-20T12:00:00.000Z"),
          mergedIntoPersonId: parentId,
          mergedAt: new Date("2026-10-20T12:00:00.000Z"),
          mergedByPersonId: owner.id,
        })
        .returning({ id: people.id });
      if (!shell) throw new Error("fixture insert failed");
      await db.insert(personRoles).values({ personId: shell.id, role: "diver" });
      parentId = shell.id;
      deepestId = shell.id;
    }
    const [credential] = await db
      .insert(staffCredentials)
      .values({
        shopId: shop.id,
        personId: deepestId,
        kind: "instructor_rating",
        name: "Deep shell instructor rating",
        identifier: "DEEP-1234",
      })
      .returning({ id: staffCredentials.id });
    if (!credential) throw new Error("fixture insert failed");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    const [deepest] = await db.select().from(people).where(eq(people.id, deepestId));
    expect(deepest).toMatchObject({ fullName: "[anonymized]", email: null });
    const [redactedCredential] = await db
      .select()
      .from(staffCredentials)
      .where(eq(staffCredentials.id, credential.id));
    expect(redactedCredential).toMatchObject({
      name: "[redacted]",
      identifier: null,
      deletedByPersonId: owner.id,
    });
    expect(redactedCredential?.deletedAt).not.toBeNull();
  });
});

describe("anonymizeDiver — a third-party roll-call note that names the diver", () => {
  it("redacts the target and merged-shell names but keeps unrelated crew prose", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, erased] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Adaeze Nwosu", dateOfBirth: "1990-04-02" },
        { shopId: shop.id, fullName: "Adaeze Nwosu", dateOfBirth: "1990-04-02" },
      ])
      .returning({ id: people.id });
    if (!source || !erased) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: erased.id, role: "diver" },
    ]);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: erased.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);
    // Historical shell whose name differs from the current survivor's name.
    await db.update(people).set({ fullName: "Maya Chen" }).where(eq(people.id, source.id));
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-10-20T12:00:00.000Z") })
      .where(eq(people.id, erased.id));
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
    await db.insert(rollCallCrewEvents).values([
      {
        shopId: shop.id,
        tripId: shopTrip.id,
        personId: owner.id,
        recordedByPersonId: owner.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt,
        note: "Last saw Bob with Maya Chen at the stern.",
      },
      {
        shopId: shop.id,
        tripId: shopTrip.id,
        personId: owner.id,
        recordedByPersonId: owner.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt,
        note: "Adaeze checked the oxygen bank before departure.",
      },
      {
        shopId: shop.id,
        tripId: shopTrip.id,
        personId: owner.id,
        recordedByPersonId: owner.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt,
        note: "Bob checked the oxygen bank before departure.",
      },
      {
        shopId: otherShop.id,
        tripId: otherTrip.id,
        personId: otherPerson.id,
        recordedByPersonId: otherPerson.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt,
        note: "Last saw Bob with Maya Chen at the stern.",
      },
    ]);
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
    expect(foreignEvent?.note).toBe("Last saw Bob with Maya Chen at the stern.");
  });
});
